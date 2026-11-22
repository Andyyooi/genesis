import { describe, expect, it } from "vitest";
import { filterMarketRows } from "@/market/filters";
import type { ListFairRange } from "@/lib/fair-range-summary";

const strong = { ticker: "STRONG", name: "Strong Company", sector: "Technology", researchScore: 60, eligible: true, insufficient: false };
const below: ListFairRange = { available: true, position: "below", low: 2, high: 3 };

describe("below-fair-range market filter", () => {
  it("combines search, eligibility and the strong-company threshold before pagination", () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ ...strong, ticker: `T${index}`, researchScore: index }));
    const options = { belowFairRange: true, fairRanges: Object.fromEntries(rows.map(row => [row.ticker, below])) };
    expect(filterMarketRows(rows, "", "", options)).toHaveLength(20);
    expect(filterMarketRows(rows, " technology ", "eligible", options)).toHaveLength(20);
    expect(filterMarketRows(rows, "T79", "", options).map(row => row.ticker)).toEqual(["T79"]);
    expect(filterMarketRows(rows, "", "excluded", options)).toEqual([]);
  });

  it("does not treat missing ranges, prices, weak or excluded companies as opportunities", () => {
    const rows = [strong, ...[59, null, NaN, Infinity].map((researchScore, i) => ({ ...strong, ticker: `WEAK${i}`, researchScore })),
      { ...strong, ticker: "EXCLUDED", eligible: false }, { ...strong, ticker: "THIN", insufficient: true },
      { ...strong, ticker: "INSIDE" }, { ...strong, ticker: "MISSING" }, { ...strong, ticker: "NO_PRICE" }];
    const fairRanges: Record<string, ListFairRange> = Object.fromEntries(rows.map(row => [row.ticker, below]));
    fairRanges.INSIDE = { ...below, position: "inside" };
    fairRanges.MISSING = { available: false };
    fairRanges.NO_PRICE = { ...below, position: null };
    expect(filterMarketRows(rows, "", "", { belowFairRange: true, fairRanges }).map(row => row.ticker)).toEqual(["STRONG"]);
    expect(filterMarketRows(rows, "", "", { belowFairRange: true })).toEqual([]);
    expect(filterMarketRows(rows)).toHaveLength(rows.length);
  });
});
