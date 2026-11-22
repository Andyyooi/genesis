import { describe, expect, it } from "vitest";
import {
  factorAvailabilityLabel,
  isFixtureEvent,
  liveWeightLabel,
  researchInterpretationBullets,
  researchVerdict,
  RESEARCH_SCORE_BLURB,
} from "@/lib/research-presentation";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import type { CategoryScore, ScoreResult } from "@/scoring/types";
import { emptyValuationContext } from "@/scoring/valuation-context";

describe("stock page verdict", () => {
  it("labels the score in plain words without overstating thin evidence", () => {
    expect(researchVerdict(72, false)).toMatchObject({ label: "Strong research score", tone: "HIGH" });
    expect(researchVerdict(58, false).label).toBe("Mid-range research score");
    expect(researchVerdict(42, false).tone).toBe("VERY_LOW");
    expect(researchVerdict(72, true).label).toBe("Check the evidence");
    expect(researchVerdict(null, false).label).toBe("Not enough evidence");
  });
});

function category(partial: Partial<CategoryScore> & { id: string }): CategoryScore {
  return {
    configuredWeight: 25,
    liveWeight: 0.25,
    score: 50,
    coverage: 1,
    availableFactorWeights: 100,
    totalFactorWeights: 100,
    inThisRun: true,
    warning: null,
    factors: [],
    ...partial,
  };
}

function baseResult(over: Partial<ScoreResult> = {}): ScoreResult {
  return {
    asOf: "2026-09-20T00:00:00.000Z",
    configHash: "test",
    profile: "default",
    researchProfile: "GENERAL",
    researchProfileReason: "test",
    researchScore: 55,
    valuationScore: 40,
    categories: [
      category({ id: "valuation", score: 40 }),
      category({ id: "quality", score: 60 }),
      category({ id: "financial_health", inThisRun: false, liveWeight: null, score: null }),
      category({ id: "growth", score: 50 }),
      category({ id: "momentum", inThisRun: false, liveWeight: null, score: null }),
      category({ id: "low_volatility", inThisRun: false, liveWeight: null, score: null }),
    ],
    concerns: [],
    notes: [],
    dataCoverage: {
      expected: 8,
      available: 4,
      unavailable: 4,
      notApplicable: 0,
      coverageRatio: 0.5,
      freshCount: 2,
      agingCount: 1,
      staleCount: 1,
      veryStaleCount: 0,
      unknownCount: 0,
      freshness: "AGING",
      periodEnd: "2024-12-31",
      availableAt: null,
      ageMonths: 9,
    },
    dataConfidence: {
      level: "MEDIUM",
      reasons: ["Coverage is partial."],
      needsVerification: false,
    },
    valuationContext: emptyValuationContext("test"),
    ...over,
  };
}

describe("research presentation helpers", () => {
  it("shows REIT-only interpretation factors only for REITs", () => {
    const metrics: MetricValue[] = ["reit_gearing", "dpu_cagr", "roe"].map((id) => ({ id, label: id === "reit_gearing" ? "REIT gearing" : id, value: 0.2, unit: "ratio", available: true, reason: null, period: null, inputs: [], formula: "test" }));
    for (const profile of ["default", "bank"] as const) {
      const text = researchInterpretationBullets({ result: baseResult({ profile }), metrics, events: [] }).join(" ");
      expect(text).not.toContain("REIT gearing");
      expect(text).not.toContain("dpu_cagr");
    }
    expect(researchInterpretationBullets({ result: baseResult({ profile: "reit", researchProfile: "REIT" }), metrics, events: [] }).join(" ")).toContain("REIT gearing");
  });
  it("labels unavailable factors without scoring them as zero", () => {
    expect(factorAvailabilityLabel(true, null)).toBe("Available");
    expect(factorAvailabilityLabel(false, null)).toBe("Unavailable — insufficient data");
    expect(factorAvailabilityLabel(false, "no EPS")).toBe("Unavailable — no EPS");
  });

  it("describes live weight vs not-in-run", () => {
    expect(liveWeightLabel(category({ id: "quality", liveWeight: 0.3, inThisRun: true }))).toBe(
      "30% of this run",
    );
    expect(liveWeightLabel(category({ id: "momentum", liveWeight: null, inThisRun: false }))).toBe(
      "Not in this run",
    );
  });

  it("flags curated fixture events", () => {
    const fixture: EventSnapshot = {
      occurredAt: "2024-01-01",
      publishedAt: "2024-01-01",
      availableAt: null,
      source: "fixture-curated",
      sourceUrl: null,
      headline: "Sample row for UI",
      excerpt: "Not a scraped article",
      classification: "Uncertain",
      relevanceNote: null,
      sourceReliability: "CURATED",
    };
    const liveish: EventSnapshot = {
      occurredAt: "2024-01-01",
      publishedAt: "2024-01-01",
      availableAt: "2024-01-02",
      source: "Bursa announcements",
      sourceUrl: "https://example.com",
      headline: "Quarterly results",
      excerpt: null,
      classification: "Positive catalyst",
      relevanceNote: null,
      sourceReliability: "OFFICIAL",
    };
    expect(isFixtureEvent(fixture)).toBe(true);
    expect(isFixtureEvent(liveish)).toBe(false);
  });

  it("builds factual interpretation bullets without recommendations", () => {
    const metrics: MetricValue[] = [
      {
        id: "price_to_earnings",
        label: "Price / EPS",
        value: 12.5,
        unit: "ratio",
        available: true,
        reason: null,
        period: "2024-12-31",
        inputs: [],
        formula: "price / eps",
      },
    ];
    const bullets = researchInterpretationBullets({
      result: baseResult(),
      metrics,
      events: [],
    });
    expect(bullets.join(" ")).toMatch(/Research profile/);
    expect(bullets.join(" ")).toContain("Price compared with yearly profit (P/E): 12.5000");
    expect(bullets.join(" ")).toContain("Trust in the evidence: medium");
    expect(bullets.join(" ").toLowerCase()).not.toMatch(
      /\b(strong buy|buy now|sell now|good stock|bad stock|undervalued opportunity)\b/,
    );
    expect(RESEARCH_SCORE_BLURB.toLowerCase()).toContain("not a buy or sell recommendation");
  });
});
