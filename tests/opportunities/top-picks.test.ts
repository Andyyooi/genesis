import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { scoreFromMetrics } from "@/scoring/score";
import type { FactorEvidence } from "@/scoring/types";
import { exclusionCounts, pickReasons, selectTopPicks, type PickCandidate } from "@/opportunities/top-picks";
import { filterMarketRows } from "@/market/filters";

function candidate(ticker: string, score: number | null, eligible = true): PickCandidate {
  const result = scoreFromMetrics({ config: loadScoringConfig(), metrics: [], instrumentType: "COMMON_STOCK", ticker, asOf: "2026-09-25" });
  return { ticker, name: ticker, lastTrade: "2026-09-25", result: { ...result, methodology: "cross-sectional-v2", researchScore: score, eligibility: { eligible, reasons: [], medianTradedValue: 200000, priceDays: 253 } } };
}
describe("published picks and market filtering", () => {
  it("ranks only eligible finite published scores, with deterministic ties and a limit", () => {
    expect(selectTopPicks([candidate("B", 75), candidate("A", 75), candidate("X", 99, false), candidate("N", null)], 1).map((row) => row.ticker)).toEqual(["A"]);
    expect(selectTopPicks([])).toEqual([]);
    expect(selectTopPicks([candidate("BAD", NaN)])).toEqual([]);
  });
  it("generates strongest percentile reasons without inventing absent or loss-making strengths", () => {
    const row = candidate("A", 75);
    const factor = (id: string, score: number, value: number): FactorEvidence => ({ id, metricId: id, label: id, category: "valuation", weight: 1, value, score, available: true, reason: null, period: null, formula: "test", inputs: [], notes: null, percentile: { market: score, sector: score, blended: score, marketCount: 100, sectorCount: 10, sectorFallback: false } });
    row.result.categories[0].factors = [factor("earnings_yield", 95, 0.1), factor("momentum_12_1", 90, 0.3), factor("roe", 80, 0.2), factor("ebit_ev", 99, -0.1)];
    const reasons = pickReasons(row.result);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toMatch(/earnings yield.*95.*top 5%/);
    expect(reasons[1]).toMatch(/momentum/);
    row.result.categories = [];
    expect(pickReasons(row.result)).toEqual([]);
  });
  it("searches ticker, name and sector without a cap and filters eligibility", () => {
    const rows = Array.from({ length: 225 }, (_, i) => ({ ticker: `T${i}`, name: "Example Company", sector: "Technology", eligible: i % 2 === 0 }));
    expect(filterMarketRows(rows)).toHaveLength(225);
    expect(filterMarketRows(rows, " technology ")).toHaveLength(225);
    expect(filterMarketRows(rows, "example", "eligible")).toHaveLength(113);
    expect(filterMarketRows(rows, "T224")[0].ticker).toBe("T224");
    expect(filterMarketRows(rows, "", "excluded")).toHaveLength(112);
    expect(filterMarketRows(rows, "absent")).toEqual([]);
    expect(exclusionCounts([{ eligible: false, exclusionReasons: ["Only 3 price days; 200 required.", "Factor coverage 10% is below 50%."] }])).toHaveLength(2);
  });
});
