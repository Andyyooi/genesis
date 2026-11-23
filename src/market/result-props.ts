import type { ListFairRange } from "@/lib/fair-range-summary";

export function toMarketResultRow(row: Record<string, unknown>, buyScore: number | null) {
  return {
    ticker: String(row.ticker),
    name: row.name,
    pn17: row.pn17,
    buyScore,
    researchScore: row.researchScore,
    valuationScore: row.valuationScore,
    needsVerification: row.needsVerification,
    confidence: row.confidence,
    coreCoverageRatio: row.coreCoverageRatio,
    coverage: row.coverage,
    eligible: row.eligible,
    instrumentType: row.instrumentType,
    researchProfile: row.researchProfile,
    freshness: row.freshness,
    availableFactors: row.availableFactors,
    expectedFactors: row.expectedFactors,
    exclusionReasons: row.exclusionReasons,
  };
}

export type MarketResultRow = ReturnType<typeof toMarketResultRow>;

export function visibleFairRanges(rows: MarketResultRow[], fairRanges: Record<string, ListFairRange>) {
  return Object.fromEntries(rows.flatMap(({ ticker }) => {
    const range = fairRanges[ticker];
    return range?.available ? [[ticker, range] as const] : [];
  }));
}
