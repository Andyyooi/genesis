import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { emptyLineItems, mergeLineItems } from "@/ingest/merge-line-items";
import { parseFundamentalsCsv } from "@/ingest/providers/csv-fundamentals";
import { computeMetrics } from "@/metrics/compute";
import { accountsUsableFrom, evidenceMetrics, piotroski, priceEvidence, usableAccounts } from "@/metrics/evidence";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import { parseYahooTimeseries } from "@/providers/yahoo-fundamentals";
import { assessEligibility } from "@/scoring/eligibility";

const config = loadScoringConfig();
function annual(periodEnd = "2025-12-31", over: Partial<StatementSnapshot> = {}): StatementSnapshot {
  return { ...emptyLineItems(), grossProfit: 50, operatingProfit: null, ebit: 20, ebitda: null, interestExpense: null,
    periodEnd, availableAt: null, statementType: "annual", source: "test", fiscalQuarter: null,
    revenue: 100, pat: 10, ocf: 12, eps: 1, shares: 10, equity: 100, totalAssets: 200, totalDebt: 30, cash: 20,
    currentAssets: 60, currentLiabilities: 20, longTermDebt: 20, ...over };
}
const metric = (rows: ReturnType<typeof evidenceMetrics>, id: string) => rows.find((m) => m.id === id)!;
function bars(count = 253): PriceBarSnapshot[] {
  return Array.from({ length: count }, (_, i) => ({ barDate: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), close: 10 * 1.001 ** i, high: 12, low: 8, adjClose: 10 * 1.002 ** i, volume: 20000 }));
}

describe("annual inputs and reporting lag", () => {
  it("uses actual available_at or a clamped calendar-month lag, never retrieval time", () => {
    expect(accountsUsableFrom(annual(), 4)).toBe("2026-04-30");
    expect(accountsUsableFrom(annual("2024-10-31"), 4)).toBe("2025-02-28");
    expect(accountsUsableFrom(annual("2023-10-31"), 4)).toBe("2024-02-29");
    const rows = [annual(), annual("2025-06-30", { availableAt: "2026-06-01" })];
    expect(usableAccounts(rows, "2026-04-29", 4)).toEqual([]);
    expect(usableAccounts(rows, "2026-04-30", 4)).toHaveLength(1);
    expect(usableAccounts(rows, "2026-06-01", 4)).toHaveLength(2);
    expect(usableAccounts([annual("2025-12-31", { actualOrEstimate: "estimate" })], "2026-10-01", 4)).toHaveLength(0);
  });
  it("applies lag to every fundamental factor, including legacy health and dividends", () => {
    const before = computeMetrics({ instrumentType: "COMMON_STOCK", periods: [annual()], bars: bars(), config, asOf: "2026-04-29" });
    for (const id of ["earnings_yield", "book_to_price", "ebit_ev", "roe", "dividend_yield", "debt_to_equity"]) expect(metric(before, id).available).toBe(false);
    const after = computeMetrics({ instrumentType: "COMMON_STOCK", periods: [annual()], bars: bars(), config, asOf: "2026-04-30" });
    for (const id of ["earnings_yield", "book_to_price", "ebit_ev", "roe", "debt_to_equity"]) expect(metric(after, id).available).toBe(true);
  });
  it("maps new Yahoo timeseries fields, uses operating income only as EBIT fallback and preserves nulls", () => {
    const point = (value: number) => [{ asOfDate: "2025-12-31", periodType: "12M", reportedValue: value }];
    const parsed = parseYahooTimeseries({ timeseries: { result: [{ annualGrossProfit: point(50), annualEBIT: point(20), annualOperatingIncome: point(19), annualCurrentAssets: point(60), annualCurrentLiabilities: point(20), annualLongTermDebt: point(10) }] } }, "yahoo");
    expect(parsed[0].lineItems).toMatchObject({ grossProfit: 50, ebit: 20, currentAssets: 60, currentLiabilities: 20, longTermDebt: 10, revenue: null });
    expect(parseYahooTimeseries({ timeseries: { result: [{ annualOperatingIncome: point(19) }] } }, "yahoo")[0].lineItems.ebit).toBe(19);
    expect(mergeLineItems(emptyLineItems(), parsed[0].lineItems).grossProfit).toBe(50);
    expect(mergeLineItems({ ...emptyLineItems(), grossProfit: 0 }, parsed[0].lineItems).grossProfit).toBe(0);
    expect(parseYahooTimeseries({}, "yahoo")).toEqual([]);
  });
  it("parses optional CSV inputs with units and rejects invalid numbers", () => {
    const header = "ticker,period_end,source,unit,gross_profit,ebit,current_assets,current_liabilities,long_term_debt\n";
    const parsed = parseFundamentalsCsv(header + "TEST,2025-12-31,csv,1000,50,20,60,20,10");
    expect(parsed.accepted[0].lineItems).toMatchObject({ grossProfit: 50000, ebit: 20000, longTermDebt: 10000 });
    expect(parseFundamentalsCsv(header + "TEST,2025-12-31,csv,1000,nope,20,60,20,10").rejected).toHaveLength(1);
  });
});

describe("evidence fundamentals", () => {
  it("measures an insurer's equity cushion and retains losses in its three-year earnings floor", () => {
    const annuals = [annual(), annual("2024-12-31", { pat: -20 }), annual("2023-12-31")];
    const rows = evidenceMetrics(annuals, [], config, "2026-09-25");
    expect(metric(rows, "equity_to_assets").value).toBe(0.5);
    expect(metric(rows, "three_year_min_roa").value).toBe(-0.1);
    expect(metric(evidenceMetrics(annuals.slice(0, 2), [], config, "2026-09-25"), "three_year_min_roa").value).toBeNull();
  });
  it("uses signed PAT / market cap, never conflicting positive EPS, and preserves EBIT losses", () => {
    const prices = [{ barDate: "2026-09-25", close: 10, high: 10, low: 10 }];
    const rows = evidenceMetrics([annual("2025-12-31", { pat: -10, eps: 1, ebit: -20 })], prices, config, "2026-09-25");
    expect(metric(rows, "earnings_yield").value).toBe(-0.1);
    expect(metric(rows, "price_to_earnings").available).toBe(false);
    expect(metric(rows, "ebit_ev").value).toBeLessThan(0);
    const missing = evidenceMetrics([annual("2025-12-31", { pat: null, cash: 10000 })], prices, config, "2026-09-25");
    expect(metric(missing, "earnings_yield").available).toBe(false);
    expect(metric(missing, "ebit_ev").available).toBe(false);
  });
  it("withholds revenue definition breaks with stable PAT but allows genuine operating declines", () => {
    const rows = [annual("2025-12-31", { revenue: 40, pat: 10 }), annual("2024-12-31", { revenue: 100, pat: 10 }), annual("2022-12-31")];
    const broken = metric(evidenceMetrics(rows, bars(), config, "2026-09-25"), "revenue_cagr");
    expect(broken.available).toBe(false);
    expect(broken.reason).toMatch(/definition break/);
    rows[0].pat = 4;
    expect(metric(evidenceMetrics(rows, bars(), config, "2026-09-25"), "revenue_cagr").value).toBeLessThan(0);
    rows[0].revenue = 80;
    rows[0].pat = 10;
    expect(metric(evidenceMetrics(rows, bars(), config, "2026-09-25"), "revenue_cagr").available).toBe(true);
  });
  it("computes value inputs, requiring every EV input and positive denominators", () => {
    const rows = evidenceMetrics([annual()], [{ barDate: "2026-09-25", close: 10, high: 10, low: 10 }], config, "2026-09-25");
    expect(metric(rows, "enterprise_value").value).toBe(110);
    expect(metric(rows, "ebit_ev").value).toBeCloseTo(20 / 110);
    expect(metric(rows, "earnings_yield").value).toBe(0.1);
    expect(metric(rows, "book_to_price").value).toBe(1);
    expect(metric(rows, "gross_profitability").value).toBe(0.25);
    const missing = evidenceMetrics([annual("2025-12-31", { cash: null, equity: -1 })], bars(), config, "2026-09-25");
    expect(metric(missing, "ebit_ev").value).toBeNull();
    expect(metric(missing, "roe").value).toBeNull();
  });
  it("uses exactly the configured growth endpoint, not the oldest available or a shorter window", () => {
    const rows = [annual(), annual("2022-12-31", { revenue: 50, eps: 0.5, dividendPerShare: 0.1 })];
    const metrics = evidenceMetrics(rows, bars(), config, "2026-09-25");
    expect(metric(metrics, "revenue_cagr").value).toBeCloseTo(2 ** (1 / 3) - 1);
    expect(metric(metrics, "eps_cagr").value).toBeCloseTo(2 ** (1 / 3) - 1);
    expect(metric(evidenceMetrics([annual(), annual("2023-12-31")], bars(), config, "2026-09-25"), "revenue_cagr").value).toBeNull();
    expect(metric(evidenceMetrics([annual(), annual("2022-12-31", { eps: -1 })], bars(), config, "2026-09-25"), "eps_cagr").value).toBeNull();
  });
  it("records all nine Piotroski components, scales only with at least six computable", () => {
    const prior = annual("2024-12-31", { pat: 5, ocf: 6, totalDebt: 40, longTermDebt: 30, currentAssets: 40, grossProfit: 30, revenue: 80, shares: 11 });
    const full = piotroski(annual(), prior);
    expect(full).toMatchObject({ points: 9, computable: 9, scaled: 9 });
    const partial = piotroski(annual("2025-12-31", { longTermDebt: null, currentAssets: null, shares: null }), prior);
    expect(partial.computable).toBe(6);
    expect(partial.scaled).toBe(9);
    expect(piotroski(annual("2025-12-31", { longTermDebt: null, currentAssets: null, shares: null, grossProfit: null }), prior).scaled).toBeNull();
    expect(piotroski(undefined, undefined)).toMatchObject({ points: 0, computable: 0, scaled: null });
  });
});

describe("price evidence", () => {
  const calendarPrices = (count = 366) => Array.from({ length: count }, (_, i) => ({ ...bars(1)[0], barDate: new Date(Date.UTC(2025, 8, 25 + i)).toISOString().slice(0, 10), close: 10 * 1.001 ** i, adjClose: 10 * 1.002 ** i })) as PriceBarSnapshot[];
  it("uses adjusted prices consistently and calendar 12–1 month endpoints", () => {
    const prices = calendarPrices();
    const base = priceEvidence(prices, "2026-09-25");
    expect(metric(base, "momentum_12_1").value).toBeCloseTo(1.002 ** 334 - 1);
    expect(metric(base, "volatility_252").value).toBeCloseTo(0, 10);
    prices[365].adjClose = 1000000;
    expect(metric(priceEvidence(prices, "2026-09-25"), "momentum_12_1").value).toBe(metric(base, "momentum_12_1").value);
    expect(metric(priceEvidence(prices, "2026-09-25"), "volatility_252").value).toBeGreaterThan(0);
  });
  it("does not mix adjusted/raw series, invent bars, count duplicate days, or use future prices", () => {
    const prices = calendarPrices();
    prices[0].adjClose = null;
    expect(metric(priceEvidence(prices, "2026-09-25"), "momentum_12_1").value).toBeCloseTo(1.001 ** 334 - 1);
    expect(metric(priceEvidence(calendarPrices(365)), "momentum_12_1").available).toBe(false);
    expect(metric(priceEvidence([...calendarPrices(365), calendarPrices(365)[0]]), "volatility_252").available).toBe(false);
    expect(metric(priceEvidence(bars(), "2025-02-01"), "momentum_12_1").available).toBe(false);
    expect(priceEvidence([]).every((m) => m.value === null)).toBe(true);
    const broken = calendarPrices().map((b) => ({ ...b, adjClose: null }));
    broken[12].close = 0;
    expect(priceEvidence(broken).every((m) => m.value === null)).toBe(true);
  });
  it("never stretches the calendar window over gaps and withholds gapped volatility", () => {
    const prices = calendarPrices().filter((b) => b.barDate < "2026-01-01" || b.barDate > "2026-02-28");
    const result = priceEvidence(prices, "2026-09-25");
    expect(metric(result, "momentum_12_1").value).toBeCloseTo(1.002 ** 334 - 1);
    expect(metric(result, "volatility_252").available).toBe(false);
    expect(metric(result, "volatility_252").reason).toMatch(/gaps/);
    const missingEndpoint = prices.filter((b) => b.barDate < "2026-08-10" || b.barDate > "2026-08-25");
    expect(metric(priceEvidence(missingEndpoint), "momentum_12_1").available).toBe(false);
  });
});

describe("recommendation eligibility", () => {
  const assess = (over: Partial<Parameters<typeof assessEligibility>[0]> = {}) => assessEligibility({ pn17: false, coverage: 1, bars: bars(), config, asOf: "2026-09-25", ...over });
  it("accepts sufficiently traded and covered names, preserving the configured RM boundary", () => {
    expect(assess().eligible).toBe(true);
    expect(assess({ bars: bars().map((b) => ({ ...b, close: 5, volume: 20000 })) }).eligible).toBe(true);
  });
  it("excludes PN17/warnings, illiquidity, short history and thin or unverified data", () => {
    expect(assess({ pn17: true }).reasons.join(" ")).toMatch(/PN17/);
    expect(assess({ warning: true }).eligible).toBe(false);
    expect(assess({ bars: bars().map((b) => ({ ...b, volume: 1 })) }).reasons.join(" ")).toMatch(/below RM 100000/);
    expect(assess({ bars: bars(199) }).reasons.join(" ")).toMatch(/199 price days/);
    expect(assess({ coverage: 0.49 }).reasons.join(" ")).toMatch(/coverage/);
    expect(assess({ bars: bars().map((b) => ({ ...b, volume: null })) }).reasons.join(" ")).toMatch(/verify liquidity/);
    expect(assess({ bars: [] }).eligible).toBe(false);
  });
});
