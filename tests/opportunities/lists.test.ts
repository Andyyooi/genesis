import { describe, expect, it } from "vitest";
import type { ScoreResult } from "@/scoring/types";
import {
  liveCoverage,
  rowMatchesList,
  type OpportunityRow,
} from "@/opportunities/lists";

function result(partial: Partial<ScoreResult> = {}): ScoreResult {
  return {
    asOf: "2026-09-20T00:00:00.000Z",
    configHash: "test",
    profile: "default",
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
    price: 10,
    lastTradeDate: "2026-09-18",
    fundamentalsPeriod: "2024-12-31",
    researchScore: scored.researchScore,
    valuationScore: scored.valuationScore,
    qualityScore: 72,
    growthScore: 70,
    healthScore: null,
    coverage: liveCoverage(scored),
    mainConcern: null,
    distanceFrom52wHigh: 0.2,
    distanceFrom52wHighAvailable: true,
    persistedResearchScores: [],
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

  it("Catalyst Watch matches nobody until news exists", () => {
    expect(rowMatchesList(row(), "catalyst")).toBe(false);
  });

  it("coverage averages live categories and does not treat news as 100%", () => {
    expect(liveCoverage(result())).toBeCloseTo(0.75);
  });
});
