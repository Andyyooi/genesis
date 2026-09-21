import { desc, eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/db/client";
import { financialPeriods, ingestFailures, ingestReports, instruments } from "@/db/schema";
import { latestAnnualHasCore, latestAnnualIsFull, parseLineItemsJson } from "@/ingest/merge-line-items";
import { assessObservationFreshness } from "@/scoring/freshness";

export type FundamentalsQualityReport = {
  kind: "fundamentals-quality";
  asOf: string;
  listed: number;
  coverage: {
    none: number;
    partial: number;
    full: number;
    usable: number;
  };
  freshness: Record<string, number>;
  failures: { code: string; count: number; examples: string[] }[];
  yahooCannot: string[];
  samples: {
    ticker: string;
    latestPeriodEnd: string | null;
    freshness: string;
    ageMonths: number | null;
    full: boolean;
    availableAt: string | null;
  }[];
};

const SAMPLE_TICKERS = ["MAYBANK", "CIMB", "KLCC", "MRDIY", "3REN", "MMAG", "ABFMY1"];

export function buildFundamentalsQualityReport(asOf = new Date().toISOString()): FundamentalsQualityReport {
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive");
  const periods = db.select().from(financialPeriods).all();
  const byInstrument = new Map<number, typeof periods>();
  for (const row of periods) {
    const list = byInstrument.get(row.instrumentId) ?? [];
    list.push(row);
    byInstrument.set(row.instrumentId, list);
  }

  const freshness: Record<string, number> = {
    FRESH: 0,
    AGING: 0,
    STALE: 0,
    VERY_STALE: 0,
    UNKNOWN: 0,
    NONE: 0,
  };
  let none = 0;
  let partial = 0;
  let full = 0;
  const samples: FundamentalsQualityReport["samples"] = [];

  for (const instrument of listed) {
    const annuals = (byInstrument.get(instrument.id) ?? [])
      .filter((row) => row.statementType === "annual")
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
    const annual =
      annuals.find((row) => latestAnnualHasCore(parseLineItemsJson(row.lineItemsJson))) ?? annuals[0];
    if (!annual) {
      none += 1;
      freshness.NONE += 1;
      if (SAMPLE_TICKERS.includes(instrument.ticker)) {
        samples.push({
          ticker: instrument.ticker,
          latestPeriodEnd: null,
          freshness: "NONE",
          ageMonths: null,
          full: false,
          availableAt: null,
        });
      }
      continue;
    }
    const items = parseLineItemsJson(annual.lineItemsJson);
    if (latestAnnualIsFull(items)) full += 1;
    else if (latestAnnualHasCore(items)) partial += 1;
    else none += 1;
    const age = assessObservationFreshness({
      asOf,
      periodEnd: annual.periodEnd,
      availableAt: annual.availableAt,
      retrievedAt: annual.retrievedAt,
    });
    freshness[age.band] += 1;
    if (SAMPLE_TICKERS.includes(instrument.ticker)) {
      samples.push({
        ticker: instrument.ticker,
        latestPeriodEnd: annual.periodEnd,
        freshness: age.band,
        ageMonths: age.ageMonths,
        full: latestAnnualIsFull(items),
        availableAt: annual.availableAt,
      });
    }
  }

  const failRows = db.select().from(ingestFailures).orderBy(desc(ingestFailures.id)).all();
  const tickerLatest = new Map<string, string>();
  for (const row of failRows) {
    if (row.kind !== "fundamentals" || !row.ticker) continue;
    if (tickerLatest.has(row.ticker)) continue;
    tickerLatest.set(row.ticker, row.failureCode ?? "UNKNOWN");
  }
  const gapTickers = new Set(
    listed
      .filter((instrument) => {
        const annuals = (byInstrument.get(instrument.id) ?? []).filter((row) => row.statementType === "annual");
        const usable = annuals.some((row) => latestAnnualHasCore(parseLineItemsJson(row.lineItemsJson)));
        return !usable;
      })
      .map((row) => row.ticker),
  );
  const byCode = new Map<string, string[]>();
  for (const ticker of gapTickers) {
    const code = tickerLatest.get(ticker) ?? "NO_DATA";
    const list = byCode.get(code) ?? [];
    list.push(ticker);
    byCode.set(code, list);
  }
  const failures = [...byCode.entries()]
    .map(([code, tickers]) => ({
      code,
      count: tickers.length,
      examples: tickers.slice(0, 8),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    kind: "fundamentals-quality",
    asOf,
    listed: listed.length,
    coverage: {
      none,
      partial,
      full,
      usable: full + partial,
    },
    freshness,
    failures,
    yahooCannot: [
      "Official PN17/GN3 status",
      "Filing/publication datetime (Yahoo asOfDate is period-end)",
      "Official REIT NAV from circulars",
      "ETF/index/bond funds Yahoo labels as EQUITY",
      "Audited notes and bank-specific statement layout",
      "Names with no Yahoo annual timeseries after mapping retries",
    ],
    samples,
  };
}

export function persistFundamentalsQualityReport(report: FundamentalsQualityReport) {
  const db = getDb();
  db.insert(ingestReports)
    .values({
      kind: "fundamentals-quality",
      startedAt: report.asOf,
      finishedAt: report.asOf,
      summaryJson: JSON.stringify(report),
    })
    .run();
  const dir = join(process.cwd(), "data/logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fundamentals-quality.last.json"), JSON.stringify(report, null, 2));
  return report;
}

export function loadLatestFundamentalsQuality(): FundamentalsQualityReport | null {
  const db = getDb();
  const row = db
    .select()
    .from(ingestReports)
    .where(eq(ingestReports.kind, "fundamentals-quality"))
    .orderBy(desc(ingestReports.id))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.summaryJson) as FundamentalsQualityReport;
  } catch {
    return null;
  }
}
