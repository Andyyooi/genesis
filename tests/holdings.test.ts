import { describe, expect, it } from "vitest";
import { backupJson, holdingValue, mergeHolding, parseBackup } from "../src/lib/holdings";

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
