import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { scoreFromMetrics } from "@/scoring/score";
import type { FactorEvidence } from "@/scoring/types";
import { exclusionCounts, loadTopPicks, parseTopPicksOptions, pickReasons, selectTopPicks, type PickCandidate } from "@/opportunities/top-picks";
import { filterMarketRows } from "@/market/filters";

const published = vi.hoisted(() => ({ scan: vi.fn(), stored: vi.fn() }));
vi.mock("@/market/scan", () => ({ loadLatestMarketScan: published.scan }));
vi.mock("@/db/client", () => ({ getSqlite: () => ({ prepare: () => ({ all: published.stored }) }) }));

function candidate(ticker: string, score: number | null, eligible = true): PickCandidate {
  const result = scoreFromMetrics({ config: loadScoringConfig(), metrics: [], instrumentType: "COMMON_STOCK", ticker, asOf: "2026-09-25" });
  return { ticker, name: ticker, lastTrade: "2026-09-25", marketCap: 2e9, lastClose: 10, result: { ...result, methodology: "cross-sectional-v2", researchScore: score, eligibility: { eligible, reasons: [], medianTradedValue: 1e6, priceDays: 253 } } };
}
describe("published picks and market filtering", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("reads cap and closing price from published scored metrics and skips unreadable evidence", () => {
    vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
    vi.stubEnv("VERCEL", "0");
    const row = candidate("A", 75);
    published.scan.mockReturnValue({ summary: { asOf: row.result.asOf }, rows: [{ ticker: "A", name: "A", researchScore: 75, eligible: true }] });
    published.stored.mockReturnValue([{ ticker: "BAD", evidence: "not json" }, { ticker: "A", evidence: JSON.stringify({ storedResult: row.result, scoredMetrics: [{ id: "market_cap", available: true, value: 2e9 }, { id: "last_close", available: true, value: 10 }] }) }]);
    expect(loadTopPicks({ lotBudget: 1000 }).picks[0]).toMatchObject({ marketCap: 2e9, lastClose: 10, selectionScore: 75 });
    expect(loadTopPicks({ lotBudget: 999 }).picks).toEqual([]);
    published.stored.mockReturnValue([{ ticker: "A", evidence: JSON.stringify({ storedResult: row.result }) }]);
    expect(loadTopPicks().picks).toEqual([]);
    published.scan.mockReturnValue({ summary: null, rows: [] });
    expect(loadTopPicks().picks).toEqual([]);
  });
  it("reuses published inputs in snapshot mode but still applies each request's options", () => {
    vi.stubEnv("BURSA_SNAPSHOT_READONLY", "1");
    const row = candidate("A", 75);
    row.result.categories.forEach(c => { c.score = c.id === "quality" ? 90 : null; });
    published.scan.mockReturnValue({ summary: { asOf: row.result.asOf }, rows: [{ ticker: "A", name: "A", researchScore: 75, eligible: true }] });
    published.stored.mockReturnValue([{ ticker: "A", evidence: JSON.stringify({ storedResult: row.result, scoredMetrics: [{ id: "market_cap", available: true, value: 2e9 }, { id: "last_close", available: true, value: 10 }] }) }]);

    expect(loadTopPicks({ lotBudget: 999 }).picks).toEqual([]);
    expect(loadTopPicks({ lotBudget: 1000, qualityTilt: true }).picks[0]).toMatchObject({ ticker: "A", selectionScore: 90 });
    expect(loadTopPicks().picks[0].selectionScore).toBe(75);
    expect(published.scan).toHaveBeenCalledTimes(1);
    expect(published.stored).toHaveBeenCalledTimes(1);
  });
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
  it("requires the configured size and liquidity floors, including known market cap", () => {
    const missing = candidate("MISSING", 99); missing.marketCap = null;
    const small = candidate("SMALL", 99); small.marketCap = 2e9 - 1;
    const thin = candidate("THIN", 99); thin.result.eligibility!.medianTradedValue = 1e6 - 1;
    const unknown = candidate("UNKNOWN", 99); unknown.result.eligibility!.medianTradedValue = null;
    const bad = candidate("BAD", 99); bad.marketCap = NaN;
    expect(selectTopPicks([missing, small, thin, unknown, bad, candidate("PASS", 60)]).map(r => r.ticker)).toEqual(["PASS"]);
    const settings = { ...loadScoringConfig().top_picks, min_market_cap: 3e9 };
    expect(selectTopPicks([candidate("A", 75)], 15, {}, settings)).toEqual([]);
  });
  it("tilts only GENERAL scores and renormalises over available categories without changing published scores", () => {
    const general = candidate("GENERAL", 40);
    general.result.categories.forEach(c => { c.score = c.id === "quality" ? 80 : c.id === "valuation" ? 20 : null; });
    const bank = candidate("BANK", 60); bank.result.researchProfile = "BANK";
    const reit = candidate("REIT", 70); reit.result.researchProfile = "REIT";
    const financial = candidate("FINANCIAL", 75); financial.result.researchProfile = "OTHER_FINANCIAL";
    const picks = selectTopPicks([general, bank, reit, financial], 15, { qualityTilt: true });
    expect(picks.map(r => r.ticker)).toEqual(["FINANCIAL", "REIT", "GENERAL", "BANK"]);
    expect(picks.find(r => r.ticker === "GENERAL")?.selectionScore).toBe(62);
    expect(picks.find(r => r.ticker === "BANK")?.selectionScore).toBe(60);
    expect(general.result.researchScore).toBe(40);
    expect(selectTopPicks([general])[0].selectionScore).toBe(40);
    general.result.categories.forEach(c => { c.score = null; });
    expect(selectTopPicks([general], 15, { qualityTilt: true })).toEqual([]);
  });
  it("uses last close times 100 for an optional inclusive lot budget", () => {
    const exact = candidate("EXACT", 75); exact.lastClose = 2.49;
    expect(selectTopPicks([exact], 15, { lotBudget: 249 }).map(r => r.ticker)).toEqual(["EXACT"]);
    expect(selectTopPicks([exact], 15, { lotBudget: 248.99 })).toEqual([]);
    const expensive = candidate("EXPENSIVE", 99); expensive.lastClose = 10.01;
    const missing = candidate("MISSING", 99); missing.lastClose = null;
    const invalid = candidate("INVALID", 99); invalid.lastClose = NaN;
    const zero = candidate("ZERO", 99); zero.lastClose = 0;
    expect(selectTopPicks([expensive, missing, invalid, zero, candidate("PASS", 60)], 15, { lotBudget: 1000 }).map(r => r.ticker)).toEqual(["PASS"]);
    expect(selectTopPicks([missing])).toHaveLength(1);
    expect(selectTopPicks([expensive], 15, { lotBudget: NaN })).toHaveLength(1);
    expect(parseTopPicksOptions({ qualityTilt: "on", lotBudget: "1000" })).toEqual({ qualityTilt: true, lotBudget: 1000 });
    for (const value of ["", "bad", "Infinity", "-1", "0", ["1000", "2000"]]) {
      expect(parseTopPicksOptions({ lotBudget: value }).lotBudget).toBeUndefined();
    }
    expect(parseTopPicksOptions({}).qualityTilt).toBe(false);
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
