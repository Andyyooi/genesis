import { describe, expect, it } from "vitest";
import { priceMetrics } from "@/metrics/prices";

describe("price metrics", () => {
  it("computes 52-week high/low from stored bars only", () => {
    const metrics = priceMetrics([
      { barDate: "2025-09-20", close: 8, high: 8.2, low: 7.9 },
      { barDate: "2026-01-15", close: 9, high: 12, low: 8.5 },
      { barDate: "2026-09-18", close: 10, high: 10.5, low: 9.7 },
    ]);
    const high = metrics.find((m) => m.id === "week52_high");
    const low = metrics.find((m) => m.id === "week52_low");
    const last = metrics.find((m) => m.id === "last_close");
    const trade = metrics.find((m) => m.id === "last_trade_date");
    expect(high?.available).toBe(true);
    expect(high?.value).toBe(12);
    expect(low?.value).toBe(7.9);
    expect(last?.value).toBe(10);
    expect(trade?.period).toBe("2026-09-18");
    expect(trade?.value).toBeNull();
  });

  it("is unavailable when there are no closes", () => {
    const metrics = priceMetrics([{ barDate: "2026-01-01", close: null, high: null, low: null }]);
    expect(metrics.every((m) => !m.available)).toBe(true);
    expect(metrics.every((m) => m.value === null)).toBe(true);
  });
});
