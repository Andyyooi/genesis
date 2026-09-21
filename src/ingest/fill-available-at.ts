import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { fiscalPeriodLabel } from "@/db/point-in-time";
import { financialPeriods, ingestReports, instruments } from "@/db/schema";
import { availabilityPatch } from "@/ingest/persist-annual-period";
import {
  classifyHttpFailure,
  FundamentalIngestError,
} from "@/providers/fundamental-failures";
import { matchReportedDateForPeriod, parseYahooEarningsChart } from "@/providers/yahoo-earnings-dates";
import { createYahooSession, yahooFetch } from "@/providers/yahoo-session";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AvailabilityFillReport = {
  kind: "available-at-yahoo";
  startedAt: string;
  finishedAt: string;
  attempted: number;
  matched: number;
  filled: number;
  skippedAlreadySet: number;
  unknown: number;
  failed: { ticker: string; reason: string }[];
};

export async function fillYahooAvailableAt(options?: {
  tickers?: string[];
  rateLimitMs?: number;
}): Promise<AvailabilityFillReport> {
  const startedAt = new Date().toISOString();
  const ingestDay = startedAt.slice(0, 10);
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive")
    .filter((row) => !options?.tickers || options.tickers.includes(row.ticker));
  const session = await createYahooSession();
  const delay = options?.rateLimitMs ?? 200;
  let matched = 0;
  let filled = 0;
  let skippedAlreadySet = 0;
  let unknown = 0;
  const failed: { ticker: string; reason: string }[] = [];

  for (const [index, instrument] of listed.entries()) {
    const annuals = db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.instrumentId, instrument.id))
      .all()
      .filter((row) => row.statementType === "annual");
    if (annuals.length === 0) {
      unknown += 1;
      if (index < listed.length - 1) await sleep(delay);
      continue;
    }
    const mappingTried = yahooSymbolCandidates(instrument);
    let dates = [] as ReturnType<typeof parseYahooEarningsChart>;
    if (mappingTried.length === 0) {
      unknown += annuals.filter((row) => !row.availableAt).length;
      skippedAlreadySet += annuals.filter((row) => Boolean(row.availableAt)).length;
      if (index < listed.length - 1) await sleep(delay);
      continue;
    }
    try {
      let lastStatus = 0;
      for (const symbol of mappingTried) {
        const url = new URL(
          `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
        );
        url.searchParams.set("crumb", session.crumb);
        url.searchParams.set("modules", "earnings");
        const response = await yahooFetch(url.toString(), session);
        lastStatus = response.status;
        if (!response.ok) {
          if (response.status === 404) continue;
          throw new FundamentalIngestError(
            classifyHttpFailure(response.status),
            `Yahoo earnings HTTP ${response.status} for ${symbol}`,
            response.status,
          );
        }
        const body = (await response.json()) as Parameters<typeof parseYahooEarningsChart>[0];
        dates = parseYahooEarningsChart(body);
        if (dates.length) break;
      }
      if (!dates.length && lastStatus === 404) {
        unknown += annuals.filter((row) => !row.availableAt).length;
        if (index < listed.length - 1) await sleep(delay);
        continue;
      }
    } catch (error) {
      failed.push({
        ticker: instrument.ticker,
        reason: error instanceof Error ? error.message : "Yahoo earnings dates failed",
      });
      if (index < listed.length - 1) await sleep(delay);
      continue;
    }

    for (const row of annuals) {
      if (row.availableAt) {
        skippedAlreadySet += 1;
        if (!row.fiscalPeriod) {
          db.update(financialPeriods)
            .set({
              fiscalPeriod: fiscalPeriodLabel({
                fiscalYear: row.fiscalYear,
                fiscalQuarter: row.fiscalQuarter,
                periodEnd: row.periodEnd,
                statementType: row.statementType,
              }),
            })
            .where(eq(financialPeriods.id, row.id))
            .run();
        }
        continue;
      }
      const hit = matchReportedDateForPeriod({
        periodEnd: row.periodEnd,
        dates,
        ingestDay,
      });
      if (!hit) {
        unknown += 1;
        continue;
      }
      matched += 1;
      const patch = availabilityPatch(row, {
        availableAt: hit.reportedDate,
        filingDate: hit.reportedDate,
        availableAtSource: "yahoo-earnings-reported-date",
        fiscalYear: row.fiscalYear,
        fiscalQuarter: row.fiscalQuarter,
      });
      db.update(financialPeriods)
        .set({
          availableAt: patch.availableAt,
          filingDate: patch.filingDate,
          availableAtSource: patch.availableAtSource,
          fiscalPeriod: patch.fiscalPeriod,
        })
        .where(eq(financialPeriods.id, row.id))
        .run();
      filled += 1;
    }
    if (index < listed.length - 1) await sleep(delay);
  }

  const report: AvailabilityFillReport = {
    kind: "available-at-yahoo",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempted: listed.length,
    matched,
    filled,
    skippedAlreadySet,
    unknown,
    failed,
  };
  db.insert(ingestReports)
    .values({
      kind: "available-at-yahoo",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify({
        ...report,
        failed: report.failed.slice(0, 40),
        failedCount: report.failed.length,
      }),
    })
    .run();
  return report;
}
