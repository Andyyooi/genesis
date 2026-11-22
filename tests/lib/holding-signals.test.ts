import { describe, expect, it } from "vitest";
import { holdingSignals } from "@/lib/holding-signals";
import type { GoodCompanyPriceDown } from "@/lib/price-drop-flag";

const range = { available: true as const, position: "below" as const, low: 2, high: 3 };
const priceDate = "2026-11-20";
const priceDown: GoodCompanyPriceDown = {
  priceDrop: { drop: 0.25, highClose: 2, highDate: "2026-10-01", lastClose: 1.5, lastDate: priceDate, adjusted: true },
  scores: [{ id: "quality", label: "Business quality", score: 70 }],
  results: { tone: "weaker", text: "Profit is lower than last year." },
};

describe("holdings signals", () => {
  it("keeps fair-range and price-down conditions independent, including both when applicable", () => {
    const both = holdingSignals({ range, priceDate, priceDown });
    expect(both.map(row => row.kind)).toEqual(["below-fair-range", "price-down"]);
    expect(both[1].why).toContain("25%");
    expect(both[1].why).toContain("Profit is lower");
    expect(holdingSignals({ range, priceDate, priceDown: null }).map(row => row.kind)).toEqual(["below-fair-range"]);
    expect(holdingSignals({ range: { ...range, position: "inside" }, priceDate, priceDown }).map(row => row.kind)).toEqual(["price-down"]);
  });

  it("does not invent a fair-range flag for missing prices/ranges or inactive stocks", () => {
    expect(holdingSignals({ range: { available: false }, priceDate, priceDown: null })).toEqual([]);
    expect(holdingSignals({ range, priceDate: null, priceDown: null })).toEqual([]);
    expect(holdingSignals({ range: { ...range, position: "above" }, priceDate, priceDown: null })).toEqual([]);
    expect(holdingSignals({ range, priceDate, priceDown, inactive: true })).toEqual([]);
  });
});
