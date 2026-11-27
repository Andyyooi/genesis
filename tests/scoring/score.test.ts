import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { percentile, rankCrossSection } from "@/scoring/rank";
import { scoreFromMetrics, scoreUniverse, type ScoreInput } from "@/scoring/score";
import { available } from "@/metrics/types";

const config = loadScoringConfig();
function input(ticker: string, value: number, over: Partial<ScoreInput> = {}): ScoreInput {
  return { config, ticker, instrumentType: "COMMON_STOCK", sector: "Technology", asOf: "2026-09-25", latestAnnual: { periodEnd: "2025-12-31", availableAt: null }, metrics: [available("earnings_yield", "E/P", value, "ratio", "EPS / price", [], "2025-12-31")], ...over };
}

describe("cross-sectional ranks", () => {
  it("uses endpoints, ties, singleton neutrality and reverse directions", () => {
    expect(percentile(1, [1, 2, 3])).toBe(0);
    expect(percentile(3, [1, 2, 3])).toBe(100);
    expect(percentile(2, [1, 2, 2, 3])).toBe(50);
    expect(percentile(1, [1, 2, 3], true)).toBe(100);
    expect(percentile(2, [2])).toBe(50);
    expect(percentile(2, [2, 2, 2])).toBe(50);
  });
  it("blends profile and sector ranks 50/50 only with at least eight available sector names", () => {
    const rows = Array.from({ length: 16 }, (_, i) => ({ ticker: String(i), value: i, sector: i < 8 ? "A" : "B", group: "default" }));
    const ranked = rankCrossSection(rows, false);
    expect(ranked.get("7")?.market).toBeCloseTo(7 / 15 * 100);
    expect(ranked.get("7")?.sector).toBe(100);
    expect(ranked.get("7")?.blended).toBeCloseTo((7 / 15 * 100 + 100) / 2);
    expect(ranked.get("7")?.sectorFallback).toBe(false);
    const small = rankCrossSection(rows.slice(0, 7), false);
    expect(small.get("3")?.sectorFallback).toBe(true);
    expect(small.get("3")?.sector).toBe(small.get("3")?.market);
    expect(rankCrossSection([{ ticker: "missing", value: null, sector: "A", group: "default" }], false).size).toBe(0);
  });
  it("keeps banks and REITs separate and excludes missing/nonfinite observations", () => {
    const ranked = rankCrossSection([
      { ticker: "ordinary", group: "default", sector: null, value: 100 },
      { ticker: "bank-low", group: "bank", sector: "Finance", value: 1 },
      { ticker: "bank-high", group: "bank", sector: "Finance", value: 2 },
      { ticker: "reit", group: "reit", sector: null, value: 0 },
      { ticker: "bad", group: "bank", sector: "Finance", value: NaN },
    ], false);
    expect(ranked.get("bank-high")?.blended).toBe(100);
    expect(ranked.get("bank-low")?.marketCount).toBe(2);
    expect(ranked.get("ordinary")?.blended).toBe(50);
    expect(ranked.get("reit")?.blended).toBe(50);
    expect(ranked.has("bad")).toBe(false);
  });
});

describe("universe scoring", () => {
  it("ranks insurer financial health against insurers and never gives one check all its weight", () => {
    const healthMetrics = (equity: number, roa?: number) => [
      available("equity_to_assets", "Equity / assets", equity, "ratio", "", [], null),
      ...(roa === undefined ? [] : [available("three_year_min_roa", "Earnings floor", roa, "ratio", "", [], null)]),
    ];
    const insurer = (ticker: string, equity: number, roa?: number) => input(ticker, 0.1, {
      industry: "Insurance - Life", sector: "Financial Services", metrics: healthMetrics(equity, roa),
    });
    const result = scoreUniverse([
      insurer("TOP", 0.3, 0.02), insurer("LOW", 0.1, -0.01), insurer("THIN", 0.2),
      input("OTHER", 0.1, { metrics: healthMetrics(0.8, 0.1) }),
    ]);
    const health = (ticker: string) => result.get(ticker)?.categories.find(({ id }) => id === "financial_health");
    expect(health("TOP")).toMatchObject({ score: 100, inThisRun: true });
    expect(health("TOP")?.factors.map(({ id }) => id)).toEqual(["equity_to_assets", "three_year_min_roa"]);
    expect(health("THIN")).toMatchObject({ score: null, inThisRun: false, coverage: 0.5 });
    expect(health("OTHER")?.factors.map(({ id }) => id)).toEqual(["debt_to_equity", "net_debt_to_ebitda", "interest_coverage"]);
  });
  it("renormalizes available factors/categories without anchors or news", () => {
    const scored = scoreUniverse([input("A", 0.01), input("B", 0.1)]);
    expect(scored.get("A")?.researchScore).toBe(0);
    expect(scored.get("B")?.researchScore).toBe(100);
    expect(scored.get("B")?.categories.find((c) => c.id === "valuation")?.liveWeight).toBe(1);
    expect(scored.get("B")?.categories.map((c) => c.id)).toEqual(["valuation", "quality", "financial_health", "growth", "momentum", "low_volatility"]);
    expect(scored.get("B")?.categories.flatMap((c) => c.factors).some((f) => /news|technical/.test(f.id))).toBe(false);
    expect(scoreUniverse([]).size).toBe(0);
  });
  it("does not fabricate a percentile for a per-ticker calculation", () => {
    const result = scoreFromMetrics(input("A", 0.05));
    expect(result.researchScore).toBeNull();
    expect(result.categories[0].factors[0].value).toBe(0.05);
    expect(result.categories[0].factors[0].available).toBe(false);
  });
  it("uses configured profile weights and omits bank industrial/REIT quality factors", () => {
    expect(config.category_weights).toEqual({ valuation: 30, quality: 25, financial_health: 10, growth: 5, momentum: 20, low_volatility: 10 });
    const bank = config.instrument_profiles.bank;
    expect(bank.category_weights).toEqual({ valuation: 30, quality: 25, financial_health: 10, growth: 5, momentum: 20, low_volatility: 10 });
    expect(bank.factor_sets.financial_health.map((f) => f.metric)).toEqual(["equity_to_assets", "three_year_min_roa"]);
    expect(bank.factor_sets.quality.map((f) => f.metric)).toEqual(["roe"]);
    expect(config.instrument_profiles.reit.category_weights).toEqual({ valuation: 35, quality: 0, financial_health: 20, growth: 10, momentum: 20, low_volatility: 15 });
    expect(config.instrument_profiles.reit.factor_sets.quality).toEqual([]);
    const results = scoreUniverse([input("MAYBANK", 0.1), input("CIMB", 0.2), input("GENERAL", 100)]);
    expect(results.get("CIMB")?.researchScore).toBe(100);
    expect(results.get("GENERAL")?.researchScore).toBe(50);
  });
  it("ranks new health factors only against banks and renormalizes missing evidence", () => {
    const equity = (value: number) => available("equity_to_assets", "Equity / assets", value, "ratio", "", [], null);
    const roa = (value: number) => available("three_year_min_roa", "Weakest return on assets", value, "ratio", "", [], null);
    const results = scoreUniverse([
      input("MAYBANK", 0, { metrics: [equity(0.1), roa(0.01)] }),
      input("CIMB", 0, { metrics: [equity(0.2)] }),
      input("PBBANK", 0),
      input("HLBANK", 0, { metrics: [equity(0.15), roa(0.02)] }),
      input("INSURER", 0, { industry: "Insurance - Life", metrics: [equity(0.9), roa(0.9)] }),
    ]);
    const health = (ticker: string) => results.get(ticker)?.categories.find(({ id }) => id === "financial_health");
    expect(health("CIMB")).toMatchObject({ score: 100, coverage: 0.5, inThisRun: true });
    expect(health("CIMB")?.factors[0].percentile?.marketCount).toBe(3);
    expect(health("CIMB")?.factors[1].score).toBeNull();
    expect(health("HLBANK")).toMatchObject({ score: 75, coverage: 1 });
    expect(health("PBBANK")).toMatchObject({ score: null, coverage: 0, inThisRun: false });
  });
  it("penalizes PN17 without changing valuation or replacing eligibility checks", () => {
    const a = input("A", 0.01, { metrics: [available("earnings_yield", "E/P", 0.01, "ratio", "", [], null), available("roe", "ROE", 0.2, "ratio", "", [], null)] });
    const b = input("B", 0.1, { metrics: [available("earnings_yield", "E/P", 0.1, "ratio", "", [], null), available("roe", "ROE", 0.1, "ratio", "", [], null)] });
    const base = scoreUniverse([a, b]).get("A")!;
    const flagged = scoreUniverse([{ ...a, pn17: true }, b]).get("A")!;
    expect(flagged.researchScore).toBeCloseTo(base.researchScore! - 20);
    expect(flagged.valuationScore).toBe(base.valuationScore);
    expect(flagged.warningPenalty).toEqual({ scoreBefore: base.researchScore, points: 20 });
    expect(flagged.eligibility?.eligible).toBe(false);
    expect(flagged.concerns.some((c) => c.id === "pn17")).toBe(true);
    const tilted = structuredClone(config);
    tilted.category_weights.valuation = 40;
    tilted.category_weights.quality = 15;
    const changed = scoreUniverse([{ ...a, config: tilted }, { ...b, config: tilted }]).get("A")!;
    expect(changed.researchScore).toBeLessThan(base.researchScore!);
    expect(changed.configHash).not.toBe(base.configHash);
  });
  it("subtracts 5 for negative FCF where applicable and leaves other warnings advisory", () => {
    const earnings = available("earnings_yield", "E/P", 0.1, "ratio", "", [], null);
    const fcf = available("fcf", "Free cash flow", -10, "myr", "", [], "2025-12-31");
    const falling = available("revenue_cagr", "Revenue CAGR", -0.1, "ratio", "", [], null);
    const cases = [
      input("GENERAL", 0, { metrics: [earnings, fcf, falling] }),
      input("MAYBANK", 0, { metrics: [earnings, fcf] }),
      input("REIT", 0, { instrumentType: "REIT", metrics: [fcf] }),
      input("MISSING", 0, { metrics: [earnings, { ...fcf, available: false }] }),
      input("ZERO", 0, { metrics: [earnings, { ...fcf, value: 0 }] }),
    ];
    const scores = scoreUniverse(cases);
    expect(scores.get("GENERAL")?.researchScore).toBe(45);
    expect(scores.get("GENERAL")?.concerns).toMatchObject([
      { id: "negative_fcf", penaltyPoints: 5, period: "2025-12-31" }, { id: "falling_revenue" },
    ]);
    for (const ticker of ["MAYBANK", "REIT", "MISSING", "ZERO"]) {
      expect(scores.get(ticker)?.concerns).toEqual([]);
      expect(scores.get(ticker)?.warningPenalty).toBeUndefined();
    }
    const noPenalties = { ...config, concerns: { ...config.concerns, apply_score_penalty: false } };
    const disabled = scoreUniverse(cases.map((row) => ({ ...row, config: noPenalties }))).get("GENERAL")!;
    expect(disabled.researchScore).toBe(50);
    expect(disabled.concerns.map((concern) => concern.id)).toEqual(["negative_fcf", "falling_revenue"]);
    expect(disabled.warningPenalty).toBeUndefined();
  });
  it("caps combined deductions at 25, floors the score at zero and leaves unscored stocks null", () => {
    const fcf = available("fcf", "Free cash flow", -10, "myr", "", [], null);
    const extra = structuredClone(config);
    extra.concerns.rules.push({ id: "additional", when: "instrument_pn17", label: "Additional warning", message: "Test", penalty_points: 5 });
    const scores = scoreUniverse([
      input("LOW", 0, { config: extra, pn17: true, metrics: [fcf, ...input("LOW", 0).metrics] }),
      input("HIGH", 1, { config: extra, pn17: true, metrics: [fcf, ...input("HIGH", 1).metrics] }),
      input("EMPTY", 0, { config: extra, pn17: true, metrics: [fcf] }),
    ]);
    expect(scores.get("HIGH")).toMatchObject({ researchScore: 75, warningPenalty: { scoreBefore: 100, points: 25 } });
    expect(scores.get("LOW")).toMatchObject({ researchScore: 0, warningPenalty: { scoreBefore: 0, points: 25 } });
    expect(scores.get("EMPTY")?.researchScore).toBeNull();
    expect(scores.get("EMPTY")?.warningPenalty).toBeUndefined();
  });
  it("does not let NaN poison ranks", () => {
    const results = scoreUniverse([input("A", NaN), input("B", 0.1)]);
    expect(results.get("A")?.researchScore).toBeNull();
    expect(results.get("B")?.researchScore).toBe(50);
  });
});
