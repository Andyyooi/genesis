import { describe, expect, it } from "vitest";
import { backupJson, holdingValue, mergeHolding, parseBackup, totalYearlyDividends, yearlyHoldingDividends } from "../src/lib/holdings";
import { annualDividend } from "../src/lib/holding-dividends";

const h = { ticker: "MAYBANK", shares: 100, averagePrice: 0.245 };
describe("holdings", () => {
  it("calculates gains without rounding share prices", () => {
    expect(holdingValue(h, 0.25)).toEqual({ cost: 24.5, value: 25, gain: 0.5, gainPercent: 0.5 / 24.5 * 100 });
    expect(holdingValue(h, 0.2).gain).toBe(-4.5);
    expect(holdingValue(h, null).value).toBeNull();
    expect(holdingValue(h, NaN).gain).toBeNull();
  });
  it("merges duplicate tickers at weighted average", () => {
    expect(mergeHolding([], h)).toEqual([h]);
    const merged = mergeHolding([h], { ...h, shares: 300, averagePrice: 0.345 })[0];
    expect(merged.shares).toBe(400);
    expect(merged.averagePrice).toBeCloseTo(0.32, 12);
    expect(() => mergeHolding([], { ...h, shares: -1 })).toThrow();
  });
  it("round trips empty and populated backups", () => {
    expect(parseBackup(backupJson([]))).toEqual([]);
    expect(parseBackup(backupJson([h]))).toEqual([h]);
    expect(parseBackup(backupJson([h, h]))[0].shares).toBe(200);
  });
  it("rejects malformed and unsafe backups", () => {
    for (const value of ["oops", "null", "{}", '{"version":2,"holdings":[]}', backupJson([{ ...h, averagePrice: 0 }]), backupJson([{ ...h, shares: Infinity }])]) expect(() => parseBackup(value)).toThrow();
  });
});

describe("yearly holding dividends", () => {
  const annual = (periodEnd: string, amount: number | null) => ({
    periodEnd, statementType: "annual", actualOrEstimate: "actual", source: "annual report", availableAt: periodEnd, fiscalQuarter: null,
    lineItemsJson: JSON.stringify({ dividendPerShare: amount }),
  });

  it("uses the full trailing cash history with its basis instead of the full-year report", () => {
    const estimate = annualDividend([annual("2025-12-31", 0.3)], "2026-11-20", {
      from: "2025-11-01", through: "2026-11-20",
      events: [{ exDate: "2026-06-15", amount: 0.1 }, { exDate: "2026-09-15", amount: 0.3 }],
    });
    expect(estimate).toEqual({ perShare: 0.4, date: "2026-11-20", label: "Last 12 months (by ex-dividend date)" });
    expect(yearlyHoldingDividends(500, estimate?.perShare ?? null)).toBe(200);
  });

  it("falls back to the latest usable annual accounts without treating single payments as annual", () => {
    const earlier = annual("2024-12-31", 0.61);
    const excluded = [
      annual("2025-12-31", null),
      { ...annual("2025-12-31", 2), source: "yahoo-quote-summary" },
      { ...annual("2026-03-31", 3), statementType: "quarterly" },
      { ...annual("2026-12-31", 4), actualOrEstimate: "estimate" },
    ];
    expect(annualDividend(excluded, "2026-11-20", null)).toBeNull();
    expect(annualDividend([earlier, ...excluded, annual("2023-12-31", 0.58)], null, null))
      .toEqual({ perShare: 0.61, date: "2024-12-31", label: "FY2024 full year" });
  });

  it("sums only available estimates and distinguishes a known zero from missing data", () => {
    const zero = annualDividend([annual("2025-12-31", 0)], null, null);
    expect(yearlyHoldingDividends(100, null)).toBeNull();
    expect(totalYearlyDividends([yearlyHoldingDividends(100, 0.61), yearlyHoldingDividends(100, zero?.perShare ?? null), null]))
      .toEqual({ total: 61, missing: 1 });
    expect(totalYearlyDividends([null, null])).toEqual({ total: null, missing: 2 });
  });
});
