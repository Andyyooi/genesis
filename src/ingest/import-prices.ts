import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { and, eq } from "drizzle-orm";
import { refreshAlertsForTicker } from "@/alerts/refresh";
import { getDb, getSqlite } from "@/db/client";
import { ingestReports, instruments, priceBars } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { usableYahooDailyBar, yahooBarDateUtc } from "@/ingest/price-bar";
import { fetchYahooDailyBars, type YahooBar } from "@/ingest/providers/yahoo-prices";
import type { PriceBarConflict, PriceImportFailure, PricesImportReport } from "@/ingest/types";
import { recordIngestFailure } from "@/market/refresh-universe";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type PriceIngestOptions = {
  onlyTicker?: string;
  range?: string;
  skipAlerts?: boolean;
  listedOnly?: boolean;
  rateLimitMs?: number;
  checkpointPath?: string;
  /** On-demand refresh sets this so one ticker does not rewrite every YAML instrument. */
  skipUniverseSeed?: boolean;
};

type Checkpoint = { done: string[] };

function loadCheckpoint(path: string | undefined): Set<string> {
  if (!path) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
    return new Set(raw.done ?? []);
  } catch {
    return new Set();
  }
}

function saveCheckpoint(path: string | undefined, done: Set<string>) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ done: [...done] }, null, 2));
}

export async function importYahooPrices(
  onlyTicker?: string | PriceIngestOptions,
  maybeOptions?: PriceIngestOptions,
): Promise<PricesImportReport> {
  const options: PriceIngestOptions =
    typeof onlyTicker === "object" && onlyTicker !== null
      ? onlyTicker
      : { ...maybeOptions, onlyTicker: onlyTicker };
  const startedAt = new Date().toISOString();
  if (!options.skipUniverseSeed) seedUniverseFromYaml();
  const db = getDb();
  let rows = db.select().from(instruments).all();
  if (options.listedOnly) rows = rows.filter((row) => row.listingStatus !== "inactive");
  const tickerFilter = options.onlyTicker;
  const targets = tickerFilter
    ? rows.filter((row) => row.ticker.toUpperCase() === tickerFilter.toUpperCase())
    : rows;

  if (tickerFilter && targets.length === 0) {
    throw new Error(`${tickerFilter} is not in the universe`);
  }

  const done = loadCheckpoint(options.checkpointPath);
  const succeeded: string[] = [];
  const failed: PriceImportFailure[] = [];
  const conflicts: PriceBarConflict[] = [];
  let barsUpserted = 0;
  let barsInserted = 0;
  let barsReimported = 0;
  const retrievedAt = new Date().toISOString();
  const range = options.range ?? "5y";
  const delay = options.rateLimitMs ?? 200;

  for (const [index, instrument] of targets.entries()) {
    const yahooTicker =
      instrument.yahooTicker ??
      (instrument.bursaCode ? `${instrument.bursaCode}.KL` : `${instrument.ticker}.KL`);
    if (done.has(instrument.ticker)) {
      succeeded.push(instrument.ticker);
      continue;
    }
    try {
      const fetched = await fetchYahooDailyBars(yahooTicker, range);
      const accepted = fetched.filter((bar) => usableYahooDailyBar(bar));
      if (accepted.length === 0) {
        throw new Error(`Yahoo missed ${yahooTicker}: no usable daily bars`);
      }
      const applied = getSqlite().transaction(() => {
        const plan = planYahooPriceWrites(instrument.ticker, accepted, storedYahooBars(instrument.id));
        for (const bar of plan.write) writePriceBar(instrument.id, bar, retrievedAt);
        return plan;
      })();
      barsUpserted += applied.write.length;
      barsInserted += applied.inserted;
      barsReimported += applied.reimported;
      conflicts.push(...applied.conflicts);
      succeeded.push(instrument.ticker);
      done.add(instrument.ticker);
      saveCheckpoint(options.checkpointPath, done);
      if (applied.write.length > 0 && !options.skipAlerts) refreshAlertsForTicker(instrument.ticker);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Yahoo request failed";
      failed.push({ ticker: instrument.ticker, yahooTicker, reason });
      recordIngestFailure("prices", instrument.ticker, yahooTicker, reason);
    }

    if (index < targets.length - 1) {
      await sleep(delay);
    }
  }

  const report: PricesImportReport = {
    kind: "prices",
    startedAt,
    finishedAt: new Date().toISOString(),
    succeeded,
    failed,
    barsUpserted,
    barsInserted,
    barsReimported,
    conflicts,
  };

  db.insert(ingestReports)
    .values({
      kind: "prices",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify(report),
    })
    .run();

  return report;
}

const CLOSE_MATCH = 1e-6;

type StoredYahooBar = { utc: number; barDate: string; close: number | null };

type PriceWritePlan = {
  write: YahooBar[];
  inserted: number;
  reimported: number;
  conflicts: PriceBarConflict[];
};

function storedYahooBars(instrumentId: number): StoredYahooBar[] {
  const rows = getDb()
    .select({ barDate: priceBars.barDate, close: priceBars.close })
    .from(priceBars)
    .where(and(eq(priceBars.instrumentId, instrumentId), eq(priceBars.source, "yahoo")))
    .all();
  const stored: StoredYahooBar[] = [];
  for (const row of rows) {
    const utc = yahooBarDateUtc(row.barDate);
    if (utc == null) continue;
    stored.push({ utc, barDate: row.barDate, close: row.close });
  }
  return stored;
}

/**
 * New sessions are inserted even when they are older than the latest bar.
 * An older session with the same close is left as it is.
 * An older session with a different close is kept and reported.
 * The latest stored session may still be revised when its close changes.
 */
function planYahooPriceWrites(ticker: string, accepted: YahooBar[], stored: StoredYahooBar[]): PriceWritePlan {
  const byUtc = new Map<number, StoredYahooBar>();
  let latestUtc: number | null = null;
  for (const row of stored) {
    byUtc.set(row.utc, row);
    if (typeof row.close === "number" && Number.isFinite(row.close) && (latestUtc == null || row.utc > latestUtc)) {
      latestUtc = row.utc;
    }
  }

  const incoming = new Map<number, YahooBar>();
  for (const bar of accepted) {
    const utc = yahooBarDateUtc(bar.barDate);
    if (utc == null || typeof bar.close !== "number" || !Number.isFinite(bar.close)) continue;
    incoming.set(utc, bar);
  }

  const write: YahooBar[] = [];
  const conflicts: PriceBarConflict[] = [];
  let inserted = 0;
  let reimported = 0;
  for (const [utc, bar] of incoming) {
    const close = bar.close;
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const existing = byUtc.get(utc);
    const storedClose =
      existing && typeof existing.close === "number" && Number.isFinite(existing.close) ? existing.close : null;
    if (storedClose == null) {
      write.push(bar);
      inserted += 1;
      continue;
    }
    if (Math.abs(storedClose - close) <= CLOSE_MATCH) {
      reimported += 1;
      continue;
    }
    if (latestUtc != null && utc < latestUtc) {
      conflicts.push({
        ticker,
        barDate: bar.barDate,
        storedClose,
        incomingClose: close,
      });
      continue;
    }
    write.push(bar);
  }
  conflicts.sort((a, b) => a.barDate.localeCompare(b.barDate));
  return { write, inserted, reimported, conflicts };
}

function writePriceBar(instrumentId: number, bar: YahooBar, retrievedAt: string) {
  getDb()
    .insert(priceBars)
    .values({
      instrumentId,
      barDate: bar.barDate,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      adjClose: bar.adjClose,
      asOf: `${bar.barDate}T16:00:00+08:00`,
      source: "yahoo",
      adjusted: bar.adjClose != null,
      retrievedAt,
    })
    .onConflictDoUpdate({
      target: [priceBars.instrumentId, priceBars.barDate, priceBars.source],
      set: {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        adjClose: bar.adjClose,
        asOf: `${bar.barDate}T16:00:00+08:00`,
        retrievedAt,
      },
    })
    .run();
}
