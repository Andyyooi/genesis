import { describe, expect, it } from "vitest";
import type { ScoreResult } from "@/scoring/types";
import { emptyValuationContext } from "@/scoring/valuation-context";
import {
  liveCoverage,
  rowMatchesFilters,
  rowMatchesList,
  sortOpportunityRows,
  type OpportunityRow,
} from "@/opportunities/lists";

function result(partial: Partial<ScoreResult> = {}): ScoreResult {
  return {
    asOf: "2026-09-20T00:00:00.000Z",
    configHash: "test",
    profile: "default",
    researchProfile: "GENERAL",
    researchProfileReason: "test fixture",
    researchScore: 60,
    valuationScore: 80,
    categories: [
      {
        id: "valuation",
        configuredWeight: 25,
        liveWeight: 0.3,
        score: 80,
        coverage: 1,
        availableFactorWeights: 100,
        totalFactorWeights: 100,
        inThisRun: true,
        warning: null,
        factors: [],
      },
      {
        id: "quality",
        configuredWeight: 25,
        liveWeight: 0.3,
        score: 72,
        coverage: 1,
        availableFactorWeights: 100,
        totalFactorWeights: 100,
        inThisRun: true,
        warning: null,
        factors: [],
      },
      {
        id: "financial_health",
        configuredWeight: 15,
        liveWeight: null,
        score: null,
        coverage: 0,
        availableFactorWeights: 0,
        totalFactorWeights: 100,
        inThisRun: false,
        warning: "omitted",
        factors: [],
      },
      {
        id: "growth",
        configuredWeight: 15,
        liveWeight: 0.2,
        score: 70,
        coverage: 1,
        availableFactorWeights: 100,
        totalFactorWeights: 100,
        inThisRun: true,
        warning: null,
        factors: [],
      },
      {
        id: "news",
        configuredWeight: 10,
        liveWeight: null,
        score: null,
        coverage: 0,
        availableFactorWeights: 0,
        totalFactorWeights: 0,
        inThisRun: false,
        warning: null,
        factors: [],
      },
      {
        id: "technical",
        configuredWeight: 10,
        liveWeight: null,
        score: null,
        coverage: 0,
        availableFactorWeights: 0,
        totalFactorWeights: 0,
        inThisRun: false,
        warning: null,
        factors: [],
      },
    ],
    concerns: [],
    notes: [],
    dataCoverage: {
      expected: 9,
      available: 6,
      unavailable: 3,
      coverageRatio: 6 / 9,
      freshCount: 6,
      agingCount: 0,
      staleCount: 0,
      veryStaleCount: 0,
      unknownCount: 0,
      freshness: "FRESH",
      periodEnd: "2025-06-30",
      availableAt: null,
      ageMonths: 3,
    },
    dataConfidence: { level: "HIGH", reasons: [], needsVerification: false },
    valuationContext: emptyValuationContext("test fixture"),
    ...partial,
  };
}

function row(over: Partial<OpportunityRow> = {}): OpportunityRow {
  const scored = over.result ?? result();
  return {
    ticker: "TEST",
    name: "Test",
    instrumentType: "COMMON_STOCK",
    pn17: false,
    shariahCompliant: null,
    listingBoard: "MAIN",
    marketCap: null,
    sector: "Consumer Cyclical",
    researchProfile: scored.researchProfile,
    price: 10,
    lastTradeDate: "2026-09-18",
    fundamentalsPeriod: "2024-12-31",
    researchScore: scored.researchScore,
    valuationScore: scored.valuationScore,
    qualityScore: 72,
    growthScore: 70,
    healthScore: null,
    coverage: liveCoverage(scored),
    coreCoverageRatio: scored.dataCoverage.coverageRatio,
    freshness: scored.dataCoverage.freshness,
    confidence: scored.dataConfidence.level,
    needsVerification: scored.dataConfidence.needsVerification,
    coreCoverageLabel: `${Math.round(scored.dataCoverage.coverageRatio * 100)}%`,
    mainConcern: null,
    distanceFrom52wHigh: 0.2,
    distanceFrom52wHighAvailable: true,
    persistedResearchScores: [],
    catalystWatch: false,
    catalystLabel: null,
    hasEvents: false,
    eventCount: 0,
    result: scored,
    ...over,
  };
}

describe("opportunity lists", () => {
  it("treats valuation ≥ 70 as potentially undervalued, not a buy", () => {
    expect(rowMatchesList(row({ valuationScore: 70 }), "undervalued")).toBe(true);
    expect(rowMatchesList(row({ valuationScore: 69 }), "undervalued")).toBe(false);
    expect(rowMatchesList(row({ valuationScore: null }), "undervalued")).toBe(false);
  });

  it("requires both quality and value for Quality + Value", () => {
    expect(rowMatchesList(row({ qualityScore: 70, valuationScore: 70 }), "quality-value")).toBe(true);
    expect(rowMatchesList(row({ qualityScore: 90, valuationScore: 40 }), "quality-value")).toBe(false);
  });

  it("Improving only when two persisted score_runs show a higher latest Research Score", () => {
    expect(rowMatchesList(row({ persistedResearchScores: [70] }), "improving")).toBe(false);
    expect(rowMatchesList(row({ persistedResearchScores: [70, 70] }), "improving")).toBe(false);
    expect(rowMatchesList(row({ persistedResearchScores: [74, 70] }), "improving")).toBe(true);
    expect(rowMatchesList(row({ persistedResearchScores: [68, 70] }), "improving")).toBe(false);
  });

  it("Recently Discounted needs 52-week history and quality still ≥ 50", () => {
    expect(
      rowMatchesList(
        row({ distanceFrom52wHigh: 0.15, distanceFrom52wHighAvailable: true, qualityScore: 50 }),
        "discounted",
      ),
    ).toBe(true);
    expect(
      rowMatchesList(
        row({ distanceFrom52wHigh: 0.2, distanceFrom52wHighAvailable: true, qualityScore: 40 }),
        "discounted",
      ),
    ).toBe(false);
    expect(
      rowMatchesList(row({ distanceFrom52wHighAvailable: false, distanceFrom52wHigh: null }), "discounted"),
    ).toBe(false);
  });

  it("Catalyst Watch uses stored classified events, not a buy list", () => {
    expect(rowMatchesList(row(), "catalyst")).toBe(false);
    expect(rowMatchesList(row({ catalystWatch: true, catalystLabel: "Positive catalyst: results" }), "catalyst")).toBe(
      true,
    );
  });

  it("coverage averages live categories and does not treat news as 100%", () => {
    expect(liveCoverage(result())).toBeCloseTo(0.6);
  });

  it("Shariah and cap-size filters are flags, not scored factors", () => {
    expect(rowMatchesFilters(row({ shariahCompliant: true }), { shariah: true })).toBe(true);
    expect(rowMatchesFilters(row({ shariahCompliant: false }), { shariah: true })).toBe(false);
    expect(rowMatchesFilters(row({ shariahCompliant: null }), { shariah: true })).toBe(false);
    expect(rowMatchesFilters(row({ marketCap: 12_000_000_000 }), { cap: "large" })).toBe(true);
    expect(rowMatchesFilters(row({ marketCap: null }), { cap: "large" })).toBe(false);
    expect(rowMatchesFilters(row({ instrumentType: "REIT" }), { instrumentType: "REIT" })).toBe(true);
    expect(rowMatchesFilters(row({ listingBoard: "MAIN" }), { board: "MAIN" })).toBe(true);
  });

  it("filters by confidence, freshness, profile, and event presence", () => {
    expect(rowMatchesFilters(row({ confidence: "HIGH" }), { confidence: "HIGH" })).toBe(true);
    expect(rowMatchesFilters(row({ confidence: "LOW" }), { confidence: "HIGH" })).toBe(false);
    expect(rowMatchesFilters(row({ freshness: "FRESH" }), { freshness: "FRESH" })).toBe(true);
    expect(rowMatchesFilters(row({ researchProfile: "BANK" }), { profile: "BANK" })).toBe(true);
    expect(rowMatchesFilters(row({ hasEvents: true }), { events: "yes" })).toBe(true);
    expect(rowMatchesFilters(row({ hasEvents: false }), { events: "yes" })).toBe(false);
  });

  it("sorts by factual attributes without inventing a best-stock rank", () => {
    const rows = [
      row({ ticker: "B", researchScore: 40, confidence: "HIGH", coreCoverageRatio: 0.4 }),
      row({ ticker: "A", researchScore: 70, confidence: "LOW", coreCoverageRatio: 0.9 }),
    ];
    expect(sortOpportunityRows(rows, "research").map((r) => r.ticker)).toEqual(["A", "B"]);
    expect(sortOpportunityRows(rows, "confidence").map((r) => r.ticker)).toEqual(["B", "A"]);
    expect(sortOpportunityRows(rows, "coverage").map((r) => r.ticker)).toEqual(["A", "B"]);
    expect(sortOpportunityRows(rows, "ticker").map((r) => r.ticker)).toEqual(["A", "B"]);
  });
});
