import { refreshAlertsForTicker } from "@/alerts/refresh";
import { getDb } from "@/db/client";
import { ingestReports, instruments, priceBars } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { fetchYahooDailyBars } from "@/ingest/providers/yahoo-prices";
import type { PriceImportFailure, PricesImportReport } from "@/ingest/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function importYahooPrices(onlyTicker?: string): Promise<PricesImportReport> {
  const startedAt = new Date().toISOString();
  seedUniverseFromYaml();
  const db = getDb();
  const rows = db.select().from(instruments).all();
  const targets = onlyTicker
    ? rows.filter((row) => row.ticker.toUpperCase() === onlyTicker.toUpperCase())
    : rows;

  if (onlyTicker && targets.length === 0) {
    throw new Error(`${onlyTicker} is not in the universe`);
  }

  const succeeded: string[] = [];
  const failed: PriceImportFailure[] = [];
  let barsUpserted = 0;
  const retrievedAt = new Date().toISOString();

  for (const [index, instrument] of targets.entries()) {
    const yahooTicker =
      instrument.yahooTicker ??
      (instrument.bursaCode ? `${instrument.bursaCode}.KL` : `${instrument.ticker}.KL`);
    try {
      const bars = await fetchYahooDailyBars(yahooTicker);
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
            asOf: `${bar.barDate}T16:00:00+08:00`,
            source: "yahoo",
            adjusted: false,
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
              asOf: `${bar.barDate}T16:00:00+08:00`,
              retrievedAt,
            },
          })
          .run();
        barsUpserted += 1;
      }
      succeeded.push(instrument.ticker);
    } catch (error) {
      failed.push({
        ticker: instrument.ticker,
        yahooTicker,
        reason: error instanceof Error ? error.message : "Yahoo request failed",
      });
    }

    if (index < targets.length - 1) {
      await sleep(200);
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

  for (const ticker of succeeded) {
    refreshAlertsForTicker(ticker);
  }

  return report;
}
