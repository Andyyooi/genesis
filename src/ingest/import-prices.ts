import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { refreshAlertsForTicker } from "@/alerts/refresh";
import { getDb } from "@/db/client";
import { ingestReports, instruments, priceBars } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { fetchYahooDailyBars } from "@/ingest/providers/yahoo-prices";
import type { PriceImportFailure, PricesImportReport } from "@/ingest/types";
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
  seedUniverseFromYaml();
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
  let barsUpserted = 0;
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
      const bars = await fetchYahooDailyBars(yahooTicker, range);
      for (const bar of bars) {
        db.insert(priceBars)
          .values({
            instrumentId: instrument.id,
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
        barsUpserted += 1;
      }
      succeeded.push(instrument.ticker);
      done.add(instrument.ticker);
      saveCheckpoint(options.checkpointPath, done);
      if (!options.skipAlerts) refreshAlertsForTicker(instrument.ticker);
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
