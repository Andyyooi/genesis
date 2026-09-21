import { countDistinct, desc, eq } from "drizzle-orm";
import { join } from "node:path";
import { importFundamentalsCsv } from "@/ingest/import-fundamentals";
import { importYahooPrices } from "@/ingest/import-prices";
import { getDb } from "@/db/client";
import { financialPeriods, instruments, marketScanRows, marketScanRuns, priceBars } from "@/db/schema";
import { importYahooFundamentals } from "@/market/ingest-fundamentals-yahoo";
import { refreshUniverse } from "@/market/refresh-universe";
import { latestAnnualPeriod } from "@/lib/snapshot-dates";
import { liveCoverage } from "@/opportunities/lists";
import { scoreTicker } from "@/scoring/run-ticker";

export type MarketScanRowPayload = {
  ticker: string;
  name: string;
  instrumentType: string;
  pn17: boolean;
  profile: string;
  researchProfile: string;
  researchScore: number | null;
  valuationScore: number | null;
  coverage: number | null;
  coreCoverageRatio: number;
  expectedFactors: number;
  availableFactors: number;
  freshness: string;
  confidence: string;
  needsVerification: boolean;
  lastTrade: string | null;
  fundamentalsPeriod: string | null;
  distanceFrom52wHigh: number | null;
  insufficient: boolean;
};

export type MarketScanSummary = {
  kind: "market-scan";
  asOf: string;
  universe: { fetched: number; upserted: number; inactivated: number; listed: number; watchlist: number };
  prices: { succeeded: number; failed: number; barsUpserted: number };
  fundamentalsCsv: { upserted: number; rejected: number };
  fundamentalsYahoo: { upserted: number; skippedHadFilings: number; failed: number };
  scores: { scored: number; insufficient: number; needsVerification: number };
  dataQuality: {
    instruments: number;
    withPrices: number;
    withFundamentals: number;
    withScores: number;
    pn17: number;
    reits: number;
    ingestFailuresThisRun: number;
  };
  highlights: {
    highestResearch: { ticker: string; score: number | null; confidence: string }[];
    highestValuation: { ticker: string; score: number | null; confidence: string }[];
    needsVerification: { ticker: string; score: number | null; confidence: string; freshness: string }[];
    largeMoves: { ticker: string; distanceFrom52wHigh: number | null }[];
    pn17: string[];
    insufficientData: string[];
  };
};

export async function runMarketScan(): Promise<MarketScanSummary> {
  const asOf = new Date().toISOString();
  const universe = await refreshUniverse();
  const prices = await importYahooPrices({
    listedOnly: true,
    skipAlerts: true,
    range: "2y",
    rateLimitMs: 200,
    checkpointPath: join(process.cwd(), "data/logs/prices-market-checkpoint.json"),
  });
  let csv;
  try {
    csv = importFundamentalsCsv(join(process.cwd(), "data/raw/fundamentals-sample.csv"));
  } catch {
    csv = { upserted: 0, rejected: [] as { ticker: string | null }[] };
  }
  const yahooFund = await importYahooFundamentals();
  return persistListedScores({
    asOf,
    universe: {
      fetched: universe.fetched,
      upserted: universe.upserted,
      inactivated: universe.inactivated,
    },
    prices: {
      succeeded: prices.succeeded.length,
      failed: prices.failed.length,
      barsUpserted: prices.barsUpserted,
    },
    fundamentalsCsv: { upserted: csv.upserted, rejected: csv.rejected.length },
    fundamentalsYahoo: {
      upserted: yahooFund.upserted,
      skippedHadFilings: yahooFund.skippedHadFilings,
      failed: yahooFund.failed.length,
    },
  });
}

/** Re-score listed names into a new scan snapshot without Yahoo ingest. */
export function rescoreListedMarket(): MarketScanSummary {
  const asOf = new Date().toISOString();
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive");
  const previous = loadLatestMarketScan().summary;
  return persistListedScores({
    asOf,
    universe: previous?.universe ?? {
      fetched: listed.length,
      upserted: 0,
      inactivated: 0,
    },
    prices: previous?.prices ?? { succeeded: 0, failed: 0, barsUpserted: 0 },
    fundamentalsCsv: previous?.fundamentalsCsv ?? { upserted: 0, rejected: 0 },
    fundamentalsYahoo: previous?.fundamentalsYahoo ?? {
      upserted: 0,
      skippedHadFilings: 0,
      failed: 0,
    },
  });
}

function persistListedScores(meta: {
  asOf: string;
  universe: { fetched: number; upserted: number; inactivated: number };
  prices: { succeeded: number; failed: number; barsUpserted: number };
  fundamentalsCsv: { upserted: number; rejected: number };
  fundamentalsYahoo: { upserted: number; skippedHadFilings: number; failed: number };
}): MarketScanSummary {
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive");

  const highestResearch: { ticker: string; score: number | null; confidence: string }[] = [];
  const highestValuation: { ticker: string; score: number | null; confidence: string }[] = [];
  const needsVerification: {
    ticker: string;
    score: number | null;
    confidence: string;
    freshness: string;
  }[] = [];
  const largeMoves: { ticker: string; distanceFrom52wHigh: number | null }[] = [];
  const pn17: string[] = [];
  const insufficientData: string[] = [];
  let scored = 0;

  const runInsert = db
    .insert(marketScanRuns)
    .values({ asOf: meta.asOf, summaryJson: "{}", createdAt: meta.asOf })
    .run();
  const runId = Number(runInsert.lastInsertRowid);

  for (const instrument of listed) {
    const scoredRow = scoreTicker(instrument.ticker, true);
    if (!scoredRow) continue;
    scored += 1;
    const coverage = liveCoverage(scoredRow.result);
    const dist = scoredRow.metrics.find((m) => m.id === "distance_from_52w_high");
    const confidence = scoredRow.result.dataConfidence;
    const dataCoverage = scoredRow.result.dataCoverage;
    const payload: MarketScanRowPayload = {
      ticker: instrument.ticker,
      name: instrument.name,
      instrumentType: scoredRow.instrumentType,
      pn17: instrument.pn17,
      profile: scoredRow.result.profile,
      researchProfile: scoredRow.result.researchProfile,
      researchScore: scoredRow.result.researchScore,
      valuationScore: scoredRow.result.valuationScore,
      coverage,
      coreCoverageRatio: dataCoverage.coverageRatio,
      expectedFactors: dataCoverage.expected,
      availableFactors: dataCoverage.available,
      freshness: dataCoverage.freshness,
      confidence: confidence.level,
      needsVerification: confidence.needsVerification,
      lastTrade: scoredRow.metrics.find((m) => m.id === "last_trade_date")?.period ?? null,
      fundamentalsPeriod: latestAnnualPeriod(scoredRow.periods),
      distanceFrom52wHigh: dist?.available ? dist.value : null,
      insufficient: coverage === null || coverage < 0.25 || scoredRow.result.researchScore === null,
    };
    db.insert(marketScanRows)
      .values({
        runId,
        instrumentId: instrument.id,
        ticker: instrument.ticker,
        payloadJson: JSON.stringify(payload),
      })
      .run();
    if (payload.insufficient) insufficientData.push(instrument.ticker);
    if (instrument.pn17) pn17.push(instrument.ticker);
    if (payload.needsVerification) {
      needsVerification.push({
        ticker: instrument.ticker,
        score: payload.researchScore,
        confidence: payload.confidence,
        freshness: payload.freshness,
      });
    } else {
      highestResearch.push({
        ticker: instrument.ticker,
        score: payload.researchScore,
        confidence: payload.confidence,
      });
      highestValuation.push({
        ticker: instrument.ticker,
        score: payload.valuationScore,
        confidence: payload.confidence,
      });
    }
    if (payload.distanceFrom52wHigh != null && payload.distanceFrom52wHigh >= 0.15) {
      largeMoves.push({ ticker: instrument.ticker, distanceFrom52wHigh: payload.distanceFrom52wHigh });
    }
  }

  const rank = (rows: { ticker: string; score: number | null; confidence: string }[]) =>
    [...rows]
      .filter((r) => r.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 15);

  const withPrices = db.select({ c: countDistinct(priceBars.instrumentId) }).from(priceBars).get();
  const withFund = db
    .select({ c: countDistinct(financialPeriods.instrumentId) })
    .from(financialPeriods)
    .get();

  const summary: MarketScanSummary = {
    kind: "market-scan",
    asOf: meta.asOf,
    universe: {
      fetched: meta.universe.fetched,
      upserted: meta.universe.upserted,
      inactivated: meta.universe.inactivated,
      listed: listed.length,
      watchlist: listed.filter((r) => r.watchlist).length,
    },
    prices: meta.prices,
    fundamentalsCsv: meta.fundamentalsCsv,
    fundamentalsYahoo: meta.fundamentalsYahoo,
    scores: {
      scored,
      insufficient: insufficientData.length,
      needsVerification: needsVerification.length,
    },
    dataQuality: {
      instruments: listed.length,
      withPrices: Number(withPrices?.c ?? 0),
      withFundamentals: Number(withFund?.c ?? 0),
      withScores: scored,
      pn17: pn17.length,
      reits: listed.filter((r) => r.instrumentType === "REIT").length,
      ingestFailuresThisRun: meta.prices.failed + meta.fundamentalsYahoo.failed,
    },
    highlights: {
      highestResearch: rank(highestResearch),
      highestValuation: rank(highestValuation),
      needsVerification: [...needsVerification]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 40),
      largeMoves: largeMoves
        .sort((a, b) => (b.distanceFrom52wHigh ?? 0) - (a.distanceFrom52wHigh ?? 0))
        .slice(0, 15),
      pn17,
      insufficientData: insufficientData.slice(0, 40),
    },
  };

  db.update(marketScanRuns)
    .set({ summaryJson: JSON.stringify(summary) })
    .where(eq(marketScanRuns.id, runId))
    .run();

  return summary;
}

export function loadLatestMarketScan(): {
  summary: MarketScanSummary | null;
  rows: Record<string, unknown>[];
} {
  const db = getDb();
  const run = db.select().from(marketScanRuns).orderBy(desc(marketScanRuns.id)).get();
  if (!run) return { summary: null, rows: [] };
  let summary: MarketScanSummary | null = null;
  try {
    summary = JSON.parse(run.summaryJson) as MarketScanSummary;
  } catch {
    summary = null;
  }
  const rows = db
    .select()
    .from(marketScanRows)
    .where(eq(marketScanRows.runId, run.id))
    .all()
    .map((row) => {
      try {
        return JSON.parse(row.payloadJson) as Record<string, unknown>;
      } catch {
        return { ticker: row.ticker };
      }
    });
  return { summary, rows };
}
