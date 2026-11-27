import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { and, eq, gt, lte, max } from "drizzle-orm";
import { refreshAlertsForTicker } from "@/alerts/refresh";
import { getDb, getSqlite } from "@/db/client";
import { loadDividendDates, saveDividendCoverage } from "@/db/dividends";
import { ingestReports, instruments, priceBars } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { inProgressSessionDate, usableYahooDailyBar, yahooBarDateUtc } from "@/ingest/price-bar";
import { fetchYahooDailyBars, type YahooBar } from "@/ingest/providers/yahoo-prices";
import type { PriceBarConflict, PriceImportFailure, PricesImportReport } from "@/ingest/types";
import { PRICE_DROP_WINDOW_BARS } from "@/lib/price-drop-flag";
import { offsetDays } from "@/lib/dividend-yield";
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
  refreshTrackRecordHistory?: boolean;
  /** Pause before one extra pass over stocks that failed. 0 (the default) skips the pass; the daily refresh uses PRICE_RETRY_PASS_DELAY_MS. */
  retryPassDelayMs?: number;
  now?: () => Date;
};

export const PRICE_RETRY_PASS_DELAY_MS = 30_000;

type Checkpoint = { done: string[] };

export function priceRangeSince(latest: string | null, now = new Date()): string {
  const timestamp = latest ? yahooBarDateUtc(latest) : null;
  if (timestamp == null || timestamp > now.getTime()) return "2y";
  const days = Math.ceil((now.getTime() - timestamp) / 86400000);
  if (days <= 3) return "5d";
  for (const [range, length] of [["1mo", 28], ["3mo", 85], ["6mo", 175], ["1y", 360]] as const) {
    if (days + 7 <= length) return range;
  }
  return "2y";
}

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
  const savedDates = new Map(options.refreshTrackRecordHistory
    ? (getSqlite().prepare("SELECT ticker, MIN(pick_date) startDate FROM track_record_entries GROUP BY ticker").all() as { ticker: string; startDate: string }[]).map((row) => [row.ticker, row.startDate])
    : []);
  let rows = db.select().from(instruments).all();
  if (options.listedOnly) rows = rows.filter((row) => row.listingStatus !== "inactive" || savedDates.has(row.ticker));
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

  const now = options.now ?? (() => new Date());
  let inProgressSession: string | null = null;
  let partialBarsRemoved = 0;

  const importOne = async (instrument: (typeof targets)[number]): Promise<PriceImportFailure | null> => {
    const yahooTicker =
      instrument.yahooTicker ??
      (instrument.bursaCode ? `${instrument.bursaCode}.KL` : `${instrument.ticker}.KL`);
    const refreshTime = now();
    const openSession = inProgressSessionDate(refreshTime);
    if (openSession) inProgressSession = openSession;
    try {
      const latest = range === "auto" ? db.select({ date: max(priceBars.barDate) }).from(priceBars)
        .where(and(eq(priceBars.instrumentId, instrument.id), gt(priceBars.close, 0), lte(priceBars.barDate, retrievedAt.slice(0, 10)))).get()?.date ?? null : null;
      const startDate = savedDates.get(instrument.ticker);
      const today = refreshTime.toISOString().slice(0, 10);
      const latestClose = latest && latest <= today && yahooBarDateUtc(latest) !== null ? latest : null;
      const dividendStart = offsetDays(latestClose ?? today, -380);
      const incremental = priceRangeSince(latest, refreshTime);
      const coverage = range === "auto" ? loadDividendDates(instrument.id) : undefined;
      const needsBackfill = range === "auto" && (latestClose !== null || startDate !== undefined) &&
        (!coverage || coverage.symbol !== yahooTicker.toUpperCase() || coverage.from > offsetDays(dividendStart, 10) ||
          coverage.through < offsetDays(today, -3));
      const requestStart = needsBackfill && (!startDate || startDate > dividendStart) ? dividendStart : startDate;
      const fetched = await fetchYahooDailyBars(yahooTicker, requestStart ? { startDate: requestStart } : range === "auto" ? incremental : range);
      let accepted = fetched.filter((bar) => usableYahooDailyBar(bar) && bar.barDate !== openSession);
      const dividendFetches = [fetched.dividendCoverage];
      const recentWindowStart = accepted.some((bar) => bar.split)
        ? recentYahooWindowStart(instrument.id)
        : undefined;
      const splitWindowStart = recentWindowStart && accepted.some((bar) => bar.split && bar.barDate >= recentWindowStart)
        ? recentWindowStart
        : undefined;
      if (splitWindowStart && !accepted.some((bar) => bar.barDate <= splitWindowStart)) {
        const splitHistory = await fetchYahooDailyBars(yahooTicker, { startDate: splitWindowStart });
        accepted = splitHistory.filter((bar) => usableYahooDailyBar(bar) && bar.barDate !== openSession);
        dividendFetches.push(splitHistory.dividendCoverage);
      }
      if (accepted.length === 0) {
        throw new Error(`Yahoo missed ${yahooTicker}: no usable daily bars`);
      }
      const applied = getSqlite().transaction(() => {
        if (openSession) partialBarsRemoved += removeInProgressBar(instrument.id, openSession);
        const plan = planYahooPriceWrites(instrument.ticker, accepted, storedYahooBars(instrument.id), retrievedAt, startDate !== undefined, splitWindowStart);
        for (const bar of plan.write) writePriceBar(instrument.id, bar, retrievedAt);
        for (const dividends of dividendFetches) {
          if (dividends?.currency === instrument.currency) saveDividendCoverage(instrument.id, dividends, retrievedAt);
        }
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
      return null;
    } catch (error) {
      return { ticker: instrument.ticker, yahooTicker, reason: error instanceof Error ? error.message : "Yahoo request failed" };
    }
  };

  let missed: { instrument: (typeof targets)[number]; failure: PriceImportFailure }[] = [];
  for (const [index, instrument] of targets.entries()) {
    if (done.has(instrument.ticker)) {
      succeeded.push(instrument.ticker);
      continue;
    }
    const failure = await importOne(instrument);
    if (failure) missed.push({ instrument, failure });
    if (index < targets.length - 1) {
      await sleep(delay);
    }
  }

  const retryPassDelay = options.retryPassDelayMs ?? 0;
  const retried = missed.map(({ instrument }) => instrument.ticker);
  const recoveredOnRetry: string[] = [];
  if (missed.length > 0 && retryPassDelay > 0) {
    await sleep(retryPassDelay);
    const stillMissed: typeof missed = [];
    for (const [index, item] of missed.entries()) {
      const failure = await importOne(item.instrument);
      if (failure) stillMissed.push({ instrument: item.instrument, failure });
      else recoveredOnRetry.push(item.instrument.ticker);
      if (index < missed.length - 1) await sleep(delay);
    }
    missed = stillMissed;
  }
  for (const { failure } of missed) {
    if (savedDates.has(failure.ticker)) console.error(`Track record price history refresh failed for ${failure.ticker}: ${failure.reason}`);
    failed.push(failure);
    recordIngestFailure("prices", failure.ticker, failure.yahooTicker, failure.reason);
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
    retried: retryPassDelay > 0 ? retried : [],
    recoveredOnRetry,
    partialBarsRemoved,
    inProgressSession,
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

type StoredYahooBar = YahooBar & { utc: number; retrievedAt: string };

type PriceWritePlan = {
  write: YahooBar[];
  inserted: number;
  reimported: number;
  conflicts: PriceBarConflict[];
};

function recentYahooWindowStart(instrumentId: number): string | undefined {
  return storedYahooBars(instrumentId)
    .filter((bar) => bar.close != null && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => b.utc - a.utc)
    .slice(0, PRICE_DROP_WINDOW_BARS)
    .at(-1)?.barDate;
}

function storedYahooBars(instrumentId: number): StoredYahooBar[] {
  const rows = getDb()
    .select({ barDate: priceBars.barDate, close: priceBars.close, open: priceBars.open, high: priceBars.high, low: priceBars.low, volume: priceBars.volume, adjClose: priceBars.adjClose, retrievedAt: priceBars.retrievedAt })
    .from(priceBars)
    .where(and(eq(priceBars.instrumentId, instrumentId), eq(priceBars.source, "yahoo")))
    .all();
  const stored: StoredYahooBar[] = [];
  for (const row of rows) {
    const utc = yahooBarDateUtc(row.barDate);
    if (utc == null) continue;
    stored.push({ ...row, utc });
  }
  return stored;
}

/**
 * New sessions are inserted even when they are older than the latest bar.
 * Matching closes accept volume/adjustment revisions without losing stored fields; the latest session also takes the day's final open/high/low.
 * A matching after-close bar confirms a legacy intraday observation.
 * An older session with a different close is kept and reported.
 * The latest stored session may still be revised when its close changes.
 */
function planYahooPriceWrites(ticker: string, accepted: YahooBar[], stored: StoredYahooBar[], retrievedAt: string, refreshAdjustments = false, splitWindowStart?: string): PriceWritePlan {
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
  const importTime = Date.parse(retrievedAt);
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
      const volume = bar.volume ?? existing!.volume;
      const adjClose = bar.adjClose != null && bar.adjClose > 0 ? bar.adjClose : existing!.adjClose;
      const initialRetrieval = Date.parse(existing!.retrievedAt);
      const bursaClose = utc + 9 * 60 * 60 * 1000; // 17:00 in Malaysia.
      const confirmsClose = initialRetrieval >= utc && initialRetrieval < bursaClose && importTime >= bursaClose;
      const latestSession = latestUtc == null || utc >= latestUtc;
      const open = latestSession ? bar.open ?? existing!.open : existing!.open;
      const high = latestSession ? bar.high ?? existing!.high : existing!.high;
      const low = latestSession ? bar.low ?? existing!.low : existing!.low;
      if (confirmsClose || volume !== existing!.volume || adjClose !== existing!.adjClose || open !== existing!.open || high !== existing!.high || low !== existing!.low) {
        write.push({ ...existing!, open, high, low, volume, adjClose });
      }
      continue;
    }
    if (latestUtc != null && utc < latestUtc) {
      const refreshAdjustedClose = refreshAdjustments || (splitWindowStart !== undefined && bar.barDate >= splitWindowStart);
      if (refreshAdjustedClose && bar.adjClose != null && bar.adjClose > 0 && bar.adjClose !== existing!.adjClose) {
        write.push({ ...existing!, adjClose: bar.adjClose });
      }
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

/** A bar saved for a session that has not closed is an intraday price, not a close. */
function removeInProgressBar(instrumentId: number, sessionDate: string): number {
  return getSqlite()
    .prepare("DELETE FROM price_bars WHERE instrument_id = ? AND source = 'yahoo' AND bar_date = ?")
    .run(instrumentId, sessionDate).changes;
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
        adjusted: bar.adjClose != null && bar.adjClose > 0,
        asOf: `${bar.barDate}T16:00:00+08:00`,
        retrievedAt,
      },
    })
    .run();
}
