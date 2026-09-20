import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods, ingestReports, instruments } from "@/db/schema";
import { recordIngestFailure } from "@/market/refresh-universe";
import { YahooFundamentalProvider } from "@/providers/yahoo-fundamentals";
import type { FundamentalProvider } from "@/providers/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type YahooFundamentalsReport = {
  kind: "fundamentals-yahoo";
  startedAt: string;
  finishedAt: string;
  attempted: number;
  upserted: number;
  skippedHadFilings: number;
  failed: { ticker: string; reason: string }[];
};

export async function importYahooFundamentals(
  provider: FundamentalProvider = new YahooFundamentalProvider(),
  options?: { rateLimitMs?: number; skipIfAnyFilings?: boolean },
): Promise<YahooFundamentalsReport> {
  const startedAt = new Date().toISOString();
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive");
  const skipIfAny = options?.skipIfAnyFilings ?? true;
  const delay = options?.rateLimitMs ?? 250;
  let upserted = 0;
  let skippedHadFilings = 0;
  const failed: { ticker: string; reason: string }[] = [];
  const retrievedAt = new Date().toISOString();

  for (const [index, instrument] of listed.entries()) {
    const existing = db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.instrumentId, instrument.id))
      .all();
    if (skipIfAny && existing.length > 0) {
      skippedHadFilings += 1;
      continue;
    }
    const yahooTicker = instrument.yahooTicker;
    if (!yahooTicker) {
      failed.push({ ticker: instrument.ticker, reason: "No yahoo_ticker on instrument" });
      recordIngestFailure("fundamentals", instrument.ticker, null, "No yahoo_ticker");
      continue;
    }
    try {
      const periods = await provider.annualPeriods(yahooTicker);
      if (provider.profile) {
        const profile = await provider.profile(yahooTicker);
        if (profile.sector || profile.industry) {
          db.update(instruments)
            .set({
              sector: instrument.sector ?? profile.sector,
              industry: instrument.industry ?? profile.industry,
              updatedAt: retrievedAt,
            })
            .where(eq(instruments.id, instrument.id))
            .run();
        }
      }
      if (periods.length === 0) {
        failed.push({
          ticker: instrument.ticker,
          reason: "Yahoo returned no annual statements (unavailable, not invented)",
        });
        recordIngestFailure(
          "fundamentals",
          instrument.ticker,
          yahooTicker,
          "No annual statements",
        );
      }
      for (const period of periods) {
        db.insert(financialPeriods)
          .values({
            instrumentId: instrument.id,
            fiscalYear: period.fiscalYear,
            fiscalQuarter: period.fiscalQuarter,
            periodEnd: period.periodEnd,
            availableAt: period.availableAt,
            retrievedAt,
            statementType: period.statementType,
            source: period.source,
            actualOrEstimate: period.actualOrEstimate,
            lineItemsJson: JSON.stringify(period.lineItems),
          })
          .onConflictDoUpdate({
            target: [
              financialPeriods.instrumentId,
              financialPeriods.periodEnd,
              financialPeriods.statementType,
              financialPeriods.source,
            ],
            set: {
              fiscalYear: period.fiscalYear,
              retrievedAt,
              lineItemsJson: JSON.stringify(period.lineItems),
            },
          })
          .run();
        upserted += 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Yahoo fundamentals failed";
      failed.push({ ticker: instrument.ticker, reason });
      recordIngestFailure("fundamentals", instrument.ticker, yahooTicker, reason);
    }
    if (index < listed.length - 1) await sleep(delay);
  }

  const report: YahooFundamentalsReport = {
    kind: "fundamentals-yahoo",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempted: listed.length,
    upserted,
    skippedHadFilings,
    failed,
  };
  db.insert(ingestReports)
    .values({
      kind: "fundamentals-yahoo",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify(report),
    })
    .run();
  return report;
}
