import { describe, expect, it } from "vitest";
import {
  factorAvailabilityLabel,
  isFixtureEvent,
  liveWeightLabel,
  researchInterpretationBullets,
  RESEARCH_SCORE_BLURB,
} from "@/lib/research-presentation";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import type { CategoryScore, ScoreResult } from "@/scoring/types";
import { emptyValuationContext } from "@/scoring/valuation-context";

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
      category({ id: "news", inThisRun: false, liveWeight: null, score: null }),
      category({ id: "technical", inThisRun: false, liveWeight: null, score: null }),
    ],
    concerns: [],
    notes: [],
    dataCoverage: {
      expected: 8,
      available: 4,
      unavailable: 4,
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
  it("labels unavailable factors without scoring them as zero", () => {
    expect(factorAvailabilityLabel(true, null)).toBe("Available");
    expect(factorAvailabilityLabel(false, null)).toBe("Unavailable — insufficient data");
    expect(factorAvailabilityLabel(false, "no EPS")).toBe("Unavailable — no EPS");
  });

  it("describes live weight vs not-in-run", () => {
    expect(liveWeightLabel(category({ id: "quality", liveWeight: 0.3, inThisRun: true }))).toBe(
      "30% of this run",
    );
    expect(liveWeightLabel(category({ id: "news", liveWeight: null, inThisRun: false }))).toBe(
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
    expect(bullets.join(" ")).toMatch(/Price \/ EPS: 12\.5000/);
    expect(bullets.join(" ")).toMatch(/confidence MEDIUM/);
    expect(bullets.join(" ").toLowerCase()).not.toMatch(
      /\b(strong buy|buy now|sell now|good stock|bad stock|undervalued opportunity)\b/,
    );
    expect(RESEARCH_SCORE_BLURB.toLowerCase()).toContain("not a buy or sell recommendation");
  });
});
