import { describe, expect, it } from "vitest";
import { getFactorProfile, loadScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import { scoreFromMetrics } from "@/scoring/score";

function m(id: string, value: number | null, available = value !== null): MetricValue {
  return {
    id,
    label: id,
    value,
    unit: "ratio",
    available,
    reason: available ? null : "unavailable in fixture",
    period: "2024-12-31",
    inputs: [{ name: id, value }],
    formula: id,
  };
}

function byCat(result: ReturnType<typeof scoreFromMetrics>, id: string) {
  const row = result.categories.find((c) => c.id === id);
  if (!row) throw new Error(id);
  return row;
}

describe("scoring engine", () => {
  const config = loadScoringConfig();

  it("splits cheap valuation from weak quality", () => {
    const cheapWeak = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [
        m("price_to_earnings", 8),
        m("dividend_yield", 0.06),
        m("roe", 0.04),
        m("net_margin", 0.04),
        m("revenue_cagr", 0.1),
        m("pat_cagr", 0.1),
      ],
    });
    expect(cheapWeak.valuationScore).toBeGreaterThan(80);
    expect(byCat(cheapWeak, "quality").score).toBeLessThan(20);
    expect(cheapWeak.researchScore).not.toBe(cheapWeak.valuationScore);

    const expensiveQuality = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [
        m("price_to_earnings", 24),
        m("dividend_yield", 0.02),
        m("roe", 0.2),
        m("net_margin", 0.25),
        m("revenue_cagr", 0.1),
        m("pat_cagr", 0.1),
      ],
    });
    expect(expensiveQuality.valuationScore).toBeLessThan(30);
    expect(byCat(expensiveQuality, "quality").score).toBeGreaterThan(80);
  });

  it("omits unavailable factors instead of scoring them as zero", () => {
    const omitted = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [m("roe", 0.18), m("net_margin", null, false)],
    });
    const quality = byCat(omitted, "quality");
    expect(quality.score).toBe(100);
    expect(quality.coverage).toBeCloseTo(0.55);
    const asZeroWouldBe = (100 * 55 + 0 * 45) / 100;
    expect(quality.score).not.toBe(asZeroWouldBe);
  });

  it("does not score negative EPS as a zero P/E", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [m("price_to_earnings", null, false), m("dividend_yield", 0.05)],
    });
    const pe = byCat(result, "valuation").factors.find((f) => f.id === "pe");
    expect(pe?.available).toBe(false);
    expect(pe?.score).toBeNull();
    expect(result.valuationScore).not.toBe(0);
    expect(result.valuationScore).toBeGreaterThan(70);
  });

  it("selects the REIT profile and does not use ordinary-company FCF/leverage factors", () => {
    const reit = getFactorProfile(config, "REIT");
    const def = getFactorProfile(config, "COMMON_STOCK");
    const reitMetrics = [
      ...reit.factor_sets.valuation,
      ...reit.factor_sets.quality,
      ...reit.factor_sets.financial_health,
    ].map((f) => f.metric);
    const defaultMetrics = [
      ...def.factor_sets.valuation,
      ...def.factor_sets.financial_health,
    ].map((f) => f.metric);

    expect(defaultMetrics).toContain("fcf");
    expect(defaultMetrics).toContain("net_debt_to_ebitda");
    expect(defaultMetrics).toContain("price_to_earnings");
    expect(reitMetrics).not.toContain("fcf");
    expect(reitMetrics).not.toContain("net_debt_to_ebitda");
    expect(reitMetrics).not.toContain("debt_to_equity");
    expect(reitMetrics).not.toContain("price_to_earnings");

    const scored = scoreFromMetrics({
      config,
      instrumentType: "REIT",
      metrics: [m("fcf", 1e9), m("debt_to_equity", 0.2), m("dividend_yield", 0.06), m("revenue_cagr", 0.04)],
    });
    expect(scored.profile).toBe("reit");
    const factorIds = scored.categories.flatMap((c) => c.factors.map((f) => f.id));
    expect(factorIds).not.toContain("fcf");
    expect(factorIds).not.toContain("debt_to_equity");
    expect(factorIds).toContain("dpu_yield");
  });

  it("marks news and technical as not in this run and renormalizes", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [
        m("price_to_earnings", 12),
        m("dividend_yield", 0.05),
        m("roe", 0.12),
        m("net_margin", 0.12),
        m("revenue_cagr", 0.06),
        m("pat_cagr", 0.06),
      ],
    });
    expect(byCat(result, "news").inThisRun).toBe(false);
    expect(byCat(result, "technical").inThisRun).toBe(false);
    expect(byCat(result, "news").configuredWeight).toBe(10);
    const live = result.categories.filter((c) => c.inThisRun);
    const liveSum = live.reduce((s, c) => s + (c.liveWeight ?? 0), 0);
    expect(liveSum).toBeCloseTo(1);
    expect(result.notes.join(" ")).toMatch(/not in this live run/);
  });

  it("changes results when YAML weights change", () => {
    const metrics = [
      m("price_to_earnings", 8),
      m("dividend_yield", 0.06),
      m("roe", 0.04),
      m("net_margin", 0.04),
      m("revenue_cagr", 0.1),
      m("pat_cagr", 0.1),
    ];
    const base = scoreFromMetrics({ config, instrumentType: "COMMON_STOCK", metrics });
    const tilted = structuredClone(config);
    tilted.category_weights.valuation = 50;
    tilted.category_weights.quality = 5;
    tilted.category_weights.financial_health = 10;
    tilted.category_weights.growth = 15;
    const changed = scoreFromMetrics({ config: tilted, instrumentType: "COMMON_STOCK", metrics });
    expect(changed.researchScore).not.toBe(base.researchScore);
    expect(changed.researchScore).toBeGreaterThan(base.researchScore as number);
    expect(changed.configHash).not.toBe(base.configHash);
  });

  it("does not apply a silent concern penalty", () => {
    const metrics = [
      m("price_to_earnings", 12),
      m("dividend_yield", 0.05),
      m("roe", 0.12),
      m("net_margin", 0.12),
      m("revenue_cagr", -0.1),
      m("pat_cagr", 0.06),
    ];
    const clean = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics,
      pn17: false,
    });
    const flagged = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics,
      pn17: true,
    });
    expect(clean.concerns.some((c) => c.id === "falling_revenue")).toBe(true);
    expect(flagged.concerns.some((c) => c.id === "pn17")).toBe(true);
    expect(flagged.researchScore).toBe(clean.researchScore);
    expect(config.concerns.apply_score_penalty).toBe(false);
  });
});
