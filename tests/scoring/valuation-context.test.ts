import { describe, expect, it } from "vitest";
import type { MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import {
  buildHistoricalPoints,
  buildValuationContext,
  closeOnOrBefore,
  combineLabels,
  emptyValuationContext,
  labelFromPercentile,
  metricFromInputs,
  MIN_HISTORICAL_POINTS,
  type PeerUniverseRow,
} from "@/scoring/valuation-context";

function annual(partial: Partial<StatementSnapshot> & { periodEnd: string }): StatementSnapshot {
  return {
    availableAt: null,
    statementType: "annual",
    source: "test",
    fiscalQuarter: null,
    revenue: 100,
    pat: 10,
    eps: 0.5,
    equity: 200,
    totalDebt: null,
    cash: null,
    ocf: null,
    capex: null,
    shares: 100,
    dividendPerShare: 0.1,
    navPerShare: null,
    totalAssets: null,
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
    ...partial,
  };
}

function barsForYears(years: string[], close = 10): PriceBarSnapshot[] {
  return years.map((periodEnd) => ({
    barDate: periodEnd,
    close,
    high: close,
    low: close,
  }));
}

function metric(id: string, value: number | null): MetricValue {
  return {
    id,
    label: id,
    value,
    unit: "ratio",
    available: value !== null,
    reason: value === null ? "unavailable in fixture" : null,
    period: "2025-12-31",
    inputs: [],
    formula: id,
  };
}

function peer(partial: Partial<PeerUniverseRow> & { ticker: string }): PeerUniverseRow {
  return {
    researchProfile: "GENERAL",
    industry: "Packaged Foods",
    sector: "Consumer",
    lastClose: 10,
    lastCloseDate: "2026-09-18",
    periodEnd: "2025-12-31",
    availableAt: null,
    eps: 1,
    dividendPerShare: 0.3,
    equity: 8,
    shares: 1,
    revenue: 5,
    pat: 1,
    ...partial,
  };
}

describe("valuation context", () => {
  it("does not claim look-ahead-safe P/E when available_at is missing", () => {
    const periods = ["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"].map((periodEnd, i) =>
      annual({ periodEnd, eps: 0.4 + i * 0.05, availableAt: null }),
    );
    const bars = barsForYears(periods.map((p) => p.periodEnd), 8);
    const { points, lookAheadSafe } = buildHistoricalPoints(periods, bars);
    expect(points.length).toBe(4);
    expect(lookAheadSafe).toBe(false);
    const ctx = buildValuationContext({
      ticker: "FOOD",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      periods,
      bars,
      metrics: [metric("last_close", 8), metric("price_to_earnings", 8 / 0.55), metric("dividend_yield", 0.1 / 8), metric("price_to_book", 4)],
      peers: Array.from({ length: 10 }, (_, i) => peer({ ticker: `P${i}`, lastClose: 12, eps: 1 })),
    });
    expect(ctx.historical.lookAheadSafe).toBe(false);
    expect(ctx.historical.limitation).toMatch(/filing date unknown/i);
    expect(ctx.historical.limitation).toMatch(/not look-ahead-safe/i);
    expect(JSON.stringify(ctx)).not.toMatch(/\bBUY\b/);
  });

  it("uses filing-date prices only when every annual has available_at", () => {
    const bars: PriceBarSnapshot[] = [
      { barDate: "2023-03-15", close: 10, high: 10, low: 10 },
      { barDate: "2024-03-15", close: 10, high: 10, low: 10 },
      { barDate: "2025-03-15", close: 10, high: 10, low: 10 },
      { barDate: "2022-12-31", close: 20, high: 20, low: 20 },
      { barDate: "2023-12-31", close: 20, high: 20, low: 20 },
      { barDate: "2024-12-31", close: 20, high: 20, low: 20 },
    ];
    const periods = [
      annual({ periodEnd: "2022-12-31", availableAt: "2023-03-15", eps: 1 }),
      annual({ periodEnd: "2023-12-31", availableAt: "2024-03-15", eps: 1 }),
      annual({ periodEnd: "2024-12-31", availableAt: "2025-03-15", eps: 1 }),
    ];
    const { points, lookAheadSafe } = buildHistoricalPoints(periods, bars);
    expect(lookAheadSafe).toBe(true);
    expect(points.every((p) => p.close === 10)).toBe(true);
  });

  it("marks historical UNAVAILABLE when overlapping prices are thinner than the sample rule", () => {
    const periods = [annual({ periodEnd: "2024-12-31" }), annual({ periodEnd: "2025-12-31" })];
    const ctx = buildValuationContext({
      ticker: "THIN",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      periods,
      bars: barsForYears(["2024-12-31", "2025-12-31"]),
      metrics: [metric("last_close", 10), metric("price_to_earnings", 20)],
      peers: [],
    });
    expect(ctx.historical.metrics[0]?.sampleSize).toBeLessThan(MIN_HISTORICAL_POINTS);
    expect(ctx.historical.label).toBe("UNAVAILABLE");
  });

  it("does not invent a peer median for empty industry or a tiny sample", () => {
    const periods = ["2022-12-31", "2023-12-31", "2024-12-31"].map((periodEnd) => annual({ periodEnd }));
    const emptyIndustry = buildValuationContext({
      ticker: "MRDIY",
      researchProfile: "GENERAL",
      industry: null,
      periods,
      bars: barsForYears(periods.map((p) => p.periodEnd)),
      metrics: [metric("last_close", 10), metric("price_to_earnings", 20)],
      peers: Array.from({ length: 20 }, (_, i) => peer({ ticker: `X${i}` })),
    });
    expect(emptyIndustry.peer.label).toBe("UNAVAILABLE");
    expect(emptyIndustry.peer.limitation).toMatch(/industry is missing/i);

    const tiny = buildValuationContext({
      ticker: "FOOD",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      periods,
      bars: barsForYears(periods.map((p) => p.periodEnd)),
      metrics: [metric("last_close", 10), metric("price_to_earnings", 8)],
      peers: [peer({ ticker: "A" }), peer({ ticker: "B" })],
    });
    expect(tiny.peer.label).toBe("UNAVAILABLE");
    expect(tiny.peer.limitation).toMatch(/too small/i);
  });

  it("uses bank metrics (P/B, yield) and not EV/EBITDA, and REIT yield/NAV not FCF", () => {
    const periods = ["2022-12-31", "2023-12-31", "2024-12-31"].map((periodEnd) =>
      annual({ periodEnd, eps: 1, equity: 8, shares: 1, dividendPerShare: 0.4 }),
    );
    const bankPeers = Array.from({ length: 8 }, (_, i) =>
      peer({
        ticker: `B${i}`,
        researchProfile: "BANK",
        industry: "Banks - Regional",
        lastClose: 12,
        equity: 10,
        shares: 1,
        eps: 1,
        dividendPerShare: 0.3,
      }),
    );
    const bank = buildValuationContext({
      ticker: "MAYBANK",
      researchProfile: "BANK",
      industry: "Banks - Regional",
      periods,
      bars: barsForYears(periods.map((p) => p.periodEnd), 9),
      metrics: [metric("last_close", 9), metric("price_to_book", 9 / 8), metric("dividend_yield", 0.4 / 9)],
      peers: bankPeers,
    });
    const bankIds = bank.peer.metrics.map((m) => m.metricId);
    expect(bankIds).toContain("price_to_book");
    expect(bankIds).toContain("dividend_yield");
    expect(bankIds).not.toContain("fcf_yield");
    expect(bankIds).not.toContain("ev_ebitda");
    expect(bank.peer.label).not.toBe("UNAVAILABLE");

    const reitPeers = Array.from({ length: 8 }, (_, i) =>
      peer({
        ticker: `R${i}`,
        researchProfile: "REIT",
        industry: "REIT - Retail",
        lastClose: 11,
        equity: 10,
        shares: 1,
        dividendPerShare: 0.5,
      }),
    );
    const reit = buildValuationContext({
      ticker: "KLCC",
      researchProfile: "REIT",
      industry: "",
      periods,
      bars: barsForYears(periods.map((p) => p.periodEnd), 9),
      metrics: [metric("last_close", 9), metric("dividend_yield", 0.4 / 9), metric("book_nav_premium", (9 - 8) / 8)],
      peers: reitPeers,
    });
    const reitIds = reit.historical.metrics.map((m) => m.metricId);
    expect(reitIds).toContain("dividend_yield");
    expect(reitIds).toContain("book_nav_premium");
    expect(reitIds).not.toContain("price_to_earnings");
    expect(reit.peer.groupDescription).toMatch(/not Yahoo sub-industry/);
  });

  it("skips a year with no close near period-end instead of using today’s price", () => {
    const px = closeOnOrBefore([{ barDate: "2026-09-18", close: 99, high: 99, low: 99 }], "2023-12-31");
    expect(px).toBeNull();
    expect(metricFromInputs("price_to_earnings", 10, { eps: -1, dividendPerShare: null, equity: 1, shares: 1, revenue: 1, pat: 1 }).value).toBeNull();
    expect(metricFromInputs("dividend_yield", 10, { eps: 1, dividendPerShare: null, equity: 1, shares: 1, revenue: 1, pat: 1 }).reason).toMatch(/not estimated/);
  });

  it("combines metric labels without creating a new overall score helper that mentions BUY", () => {
    expect(combineLabels(["POSITIVE", "NEUTRAL"])).toBe("POSITIVE");
    expect(combineLabels(["NEGATIVE", "NEGATIVE", "POSITIVE"])).toBe("NEGATIVE");
    expect(combineLabels(["UNAVAILABLE", "UNAVAILABLE"])).toBe("UNAVAILABLE");
    expect(labelFromPercentile(20, "lower_better")).toBe("POSITIVE");
    expect(labelFromPercentile(80, "lower_better")).toBe("NEGATIVE");
    expect(emptyValuationContext("x").historical.label).toBe("UNAVAILABLE");
  });
});
