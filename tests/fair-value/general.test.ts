import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateSqliteSchema } from "@/db/client";
import { calculateGeneralFairValue } from "@/fair-value/calculate";
import { insertFairValueRun, persistFairValueRun } from "@/fair-value/persist";
import type { FairValueMethodId, FairValueResult } from "@/fair-value/types";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import { loadScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import { scoreFromMetrics } from "@/scoring/score";
import type { PeerUniverseRow } from "@/scoring/peer-group";

const AS_OF = "2026-09-28T00:00:00.000Z";
const INDUSTRY = "Widgets - Industrial";
const SECTOR = "Industrials";

function annual(args: {
  periodEnd: string;
  eps?: number | null;
  equity?: number | null;
  shares?: number | null;
  dividendPerShare?: number | null;
  availableAt?: string | null;
}): StatementSnapshot {
  return {
    periodEnd: args.periodEnd,
    availableAt: args.availableAt ?? null,
    statementType: "annual",
    source: "fixture",
    fiscalQuarter: null,
    revenue: 100,
    pat: 10,
    eps: args.eps ?? null,
    equity: args.equity ?? null,
    totalDebt: null,
    cash: null,
    ocf: null,
    capex: null,
    shares: args.shares ?? null,
    dividendPerShare: args.dividendPerShare ?? null,
    navPerShare: null,
    totalAssets: null,
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
  };
}

function bar(barDate: string, close: number | null): PriceBarSnapshot {
  return { barDate, close, high: null, low: null };
}

function peer(args: {
  ticker: string;
  close?: number | null;
  eps?: number | null;
  equity?: number | null;
  shares?: number | null;
  dividendPerShare?: number | null;
  industry?: string;
}): PeerUniverseRow {
  return {
    ticker: args.ticker,
    name: args.ticker,
    listingStatus: "listed",
    instrumentType: "COMMON_STOCK",
    researchProfile: "GENERAL",
    industry: args.industry ?? INDUSTRY,
    sector: SECTOR,
    lastClose: args.close === undefined ? 10 : args.close,
    lastCloseDate: "2026-09-25",
    periodEnd: "2025-12-31",
    availableAt: null,
    eps: args.eps === undefined ? 1 : args.eps,
    dividendPerShare: args.dividendPerShare === undefined ? 0.4 : args.dividendPerShare,
    equity: args.equity === undefined ? 50 : args.equity,
    shares: args.shares === undefined ? 10 : args.shares,
    revenue: 100,
    pat: 10,
  };
}

function peers(count: number, patch?: Partial<Parameters<typeof peer>[0]>): PeerUniverseRow[] {
  return Array.from({ length: count }, (_, i) =>
    peer({ ticker: `P${i + 1}`, ...patch }),
  );
}

function value(args: {
  profile?: ResearchProfile;
  periods?: StatementSnapshot[];
  bars?: PriceBarSnapshot[];
  peers?: PeerUniverseRow[];
  asOf?: string;
  industry?: string | null;
  sector?: string | null;
}): FairValueResult {
  return calculateGeneralFairValue({
    ticker: "ACME",
    researchProfile: args.profile ?? "GENERAL",
    industry: args.industry === undefined ? INDUSTRY : args.industry,
    sector: args.sector === undefined ? SECTOR : args.sector,
    periods: args.periods ?? [],
    bars: args.bars ?? [bar("2026-09-25", 11)],
    peers: args.peers ?? [],
    asOf: args.asOf ?? AS_OF,
  });
}

function method(result: FairValueResult, id: FairValueMethodId) {
  const row = result.methods.find((item) => item.id === id);
  if (!row) throw new Error(id);
  return row;
}

function assertFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertFiniteNumbers(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertFiniteNumbers(item);
  }
}

describe("GENERAL fair value", () => {
  it("prices earnings at the peer median P/E", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      peers: peers(5, { close: 10, eps: 1, dividendPerShare: null, equity: null, shares: null }),
    });
    const row = method(result, "earnings_peer_pe");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBe(10);
    expect(row.methodValue).toBe(20);
    expect(row.peerCount).toBe(5);
    expect(row.peerGroup).toContain("Widgets - Industrial");
    expect(row.formula).toBe("EPS × peer median P/E");
    expect(result.fairValueBase).toBe(20);
    expect(result.fairValueLow).toBeNull();
    expect(result.fairValueHigh).toBeNull();
    expect(result.confidence).toBe("LOW");
    expect(result.assumptions.yamlScoreBandsUsed).toBe(false);
    expect(result.assumptions.modelDefaultsUsed).toBe(false);
  });

  it("prices earnings at the own-history median P/E and records period-end prices as not look-ahead-safe", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1 }),
        annual({ periodEnd: "2024-12-31", eps: 1 }),
        annual({ periodEnd: "2025-12-31", eps: 2 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 20),
        bar("2026-09-25", 11),
      ],
    });
    const row = method(result, "earnings_history_pe");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBe(10);
    expect(row.methodValue).toBe(20);
    expect(row.historicalSampleCount).toBe(3);
    expect(row.lookAheadSafe).toBe(false);
    expect(row.priceDates).toEqual(["2023-12-31", "2024-12-31", "2025-12-31"]);
    expect(result.assumptions.lookAheadSafe).toBe(false);
    expect(result.assumptions.historicalValuationStatus).toBe("PERIOD_END_ONLY");
    expect(result.assumptions.historicalLimitation).toContain("not look-ahead-safe");
  });

  it("marks history look-ahead-safe only when every annual has available_at", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", availableAt: "2024-02-28", eps: 1 }),
        annual({ periodEnd: "2024-12-31", availableAt: "2025-02-28", eps: 1 }),
        annual({ periodEnd: "2025-12-31", availableAt: "2026-02-28", eps: 1 }),
      ],
      bars: [
        bar("2024-02-28", 8),
        bar("2025-02-28", 10),
        bar("2026-02-28", 12),
        bar("2026-09-25", 11),
      ],
    });
    expect(method(result, "earnings_history_pe").lookAheadSafe).toBe(true);
    expect(result.assumptions.lookAheadSafe).toBe(true);
    expect(result.assumptions.historicalValuationStatus).toBe("POINT_IN_TIME_SAFE");
    expect(result.assumptions.historicalLimitation ?? "").not.toContain("not look-ahead-safe");
  });

  it("prices book value at the peer median P/B", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: peers(5, { close: 10, equity: 50, shares: 10, eps: null, dividendPerShare: null }),
    });
    const row = method(result, "book_peer_pb");
    expect(row.available).toBe(true);
    expect(row.currentInput).toBe(10);
    expect(row.medianMultiple).toBe(2);
    expect(row.methodValue).toBe(20);
    expect(row.formula).toBe("book value per share × peer median P/B");
  });

  it("prices book value at the own-history median P/B", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 80, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 20),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
    });
    const row = method(result, "book_history_pb");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBe(1.2);
    expect(row.methodValue).toBeCloseTo(12);
    expect(row.lookAheadSafe).toBe(false);
  });

  it("prices DPS at the peer median dividend yield and does not treat a missing peer DPS as zero in the median", () => {
    const rows = peers(5, { close: 10, dividendPerShare: 0.4, eps: null, equity: null, shares: null });
    rows.push(peer({ ticker: "NODIV", dividendPerShare: null, eps: null, equity: null, shares: null }));
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", dividendPerShare: 0.5 })],
      peers: rows,
    });
    const row = method(result, "dividend_peer_yield");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBeCloseTo(0.04);
    expect(row.peerCount).toBe(5);
    expect(row.methodValue).toBeCloseTo(12.5);
    expect(row.formula).toBe("DPS / peer median dividend yield");
  });

  it("prices DPS at the own-history median dividend yield", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", dividendPerShare: 0.2 }),
        annual({ periodEnd: "2024-12-31", dividendPerShare: 0.4 }),
        annual({ periodEnd: "2025-12-31", dividendPerShare: 0.5 }),
      ],
      bars: [
        bar("2023-12-31", 10),
        bar("2024-12-31", 10),
        bar("2025-12-31", 10),
        bar("2026-09-25", 11),
      ],
    });
    const row = method(result, "dividend_history_yield");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBeCloseTo(0.04);
    expect(row.methodValue).toBeCloseTo(12.5);
    expect(result.assumptions.historicalLimitation).toContain("not look-ahead-safe");
  });

  it("returns unavailable when no method clears", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31" })],
      peers: peers(2),
    });
    expect(result.confidence).toBe("UNAVAILABLE");
    expect(result.fairValueBase).toBeNull();
    expect(result.fairValueLow).toBeNull();
    expect(result.fairValueHigh).toBeNull();
    expect(result.differenceVsPrice).toBeNull();
    expect(result.unavailableReason).toContain("Earnings × peer median P/E");
    expect(result.unavailableReason).toContain("EPS is unavailable");
  });

  it("keeps the range unavailable when only one method is valid", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      peers: peers(5, { close: 10, eps: 1 }),
      bars: [bar("2026-09-25", 11)],
    });
    expect(result.fairValueBase).toBe(20);
    expect(result.fairValueLow).toBeNull();
    expect(result.fairValueHigh).toBeNull();
    expect(result.differenceVsPrice).toBeCloseTo((20 - 11) / 11);
    expect(result.currentPrice).toBe(11);
    expect(result.valuationDate).toBe("2026-09-25");
    expect(result.confidence).toBe("LOW");
  });

  it("uses min, median, and max for two methods", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10 })],
      peers: peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: null }),
    });
    expect(method(result, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBe(15);
    expect(result.fairValueHigh).toBe(20);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("uses the middle value, not the mean, for three methods", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 70, shares: 10, dividendPerShare: 1.5 })],
      peers: peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.5 }),
    });
    expect(method(result, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(result, "book_peer_pb").methodValue).toBe(14);
    expect(method(result, "dividend_peer_yield").methodValue).toBe(30);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBe(14);
    expect(result.fairValueHigh).toBe(30);
    expect(result.confidence).toBe("HIGH");
  });

  it("averages the two middle values when an even number of methods is valid", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1 }),
        annual({ periodEnd: "2024-12-31", eps: 1 }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
      peers: peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.4 }),
    });
    expect(method(result, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(result, "earnings_history_pe").methodValue).toBe(10);
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(method(result, "dividend_peer_yield").methodValue).toBeCloseTo(12.5);
    expect(method(result, "book_history_pb").available).toBe(false);
    expect(method(result, "dividend_history_yield").available).toBe(false);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBeCloseTo(11.25);
    expect(result.fairValueHigh).toBe(20);
  });

  it("does not price negative, zero, or missing EPS", () => {
    const negative = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: -1, equity: 100, shares: 10 })],
      peers: peers(5),
    });
    expect(method(negative, "earnings_peer_pe").available).toBe(false);
    expect(method(negative, "earnings_peer_pe").unavailableReason).toContain("zero or negative");
    expect(method(negative, "book_peer_pb").available).toBe(true);

    const zero = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 0 })],
      peers: peers(5),
    });
    expect(method(zero, "earnings_peer_pe").unavailableReason).toContain("zero or negative");

    const missing = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: null, equity: 100, shares: 10 })],
      peers: peers(5),
    });
    expect(method(missing, "earnings_peer_pe").unavailableReason).toBe("EPS is unavailable");
    expect(method(missing, "book_peer_pb").available).toBe(true);
  });

  it("does not price missing, zero, or negative book value", () => {
    const missingShares = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: null, eps: 1 })],
      peers: peers(5),
    });
    expect(method(missingShares, "book_peer_pb").unavailableReason).toBe("Shares are unavailable");

    const zeroShares = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 0, eps: 1 })],
      peers: peers(5),
    });
    expect(method(zeroShares, "book_peer_pb").unavailableReason).toContain("zero or negative");

    const negativeBook = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: -50, shares: 10, eps: 1 })],
      peers: peers(5),
    });
    expect(method(negativeBook, "book_peer_pb").unavailableReason).toContain("Book value per share");
    expect(method(negativeBook, "earnings_peer_pe").available).toBe(true);
  });

  it("does not treat missing or zero DPS as a dividend method", () => {
    const missing = value({
      periods: [annual({ periodEnd: "2025-12-31", dividendPerShare: null, eps: 1 })],
      peers: peers(5),
    });
    expect(method(missing, "dividend_peer_yield").unavailableReason).toContain("not treated as zero");
    expect(method(missing, "earnings_peer_pe").available).toBe(true);

    const zero = value({
      periods: [annual({ periodEnd: "2025-12-31", dividendPerShare: 0, eps: 1 })],
      peers: peers(5),
    });
    expect(method(zero, "dividend_peer_yield").unavailableReason).toContain("zero or negative");
  });

  it("drops zero and negative peer dividend yields from the median", () => {
    const zeroYield = value({
      periods: [annual({ periodEnd: "2025-12-31", dividendPerShare: 0.5, eps: 1 })],
      peers: peers(5, { dividendPerShare: 0, eps: 1 }),
    });
    expect(method(zeroYield, "dividend_peer_yield").available).toBe(false);
    expect(method(zeroYield, "dividend_peer_yield").unavailableReason).toContain("need 5");
    expect(method(zeroYield, "earnings_peer_pe").available).toBe(true);

    const negativeYield = value({
      periods: [annual({ periodEnd: "2025-12-31", dividendPerShare: 0.5, eps: 1 })],
      peers: peers(5, { dividendPerShare: -0.4, eps: 1 }),
    });
    expect(method(negativeYield, "dividend_peer_yield").available).toBe(false);
    expect(method(negativeYield, "dividend_peer_yield").sampleSize).toBe(0);
  });

  it("refuses a peer method below 5 usable names and a history method below 3 points", () => {
    const fewPeers = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1 })],
      peers: peers(4),
    });
    expect(method(fewPeers, "earnings_peer_pe").available).toBe(false);
    expect(method(fewPeers, "earnings_peer_pe").unavailableReason).toContain("5");
    expect(fewPeers.confidence).toBe("UNAVAILABLE");

    const fewYears = value({
      periods: [
        annual({ periodEnd: "2024-12-31", eps: 1 }),
        annual({ periodEnd: "2025-12-31", eps: 1 }),
      ],
      bars: [bar("2024-12-31", 10), bar("2025-12-31", 10), bar("2026-09-25", 11)],
      industry: null,
      sector: null,
    });
    expect(method(fewYears, "earnings_history_pe").available).toBe(false);
    expect(method(fewYears, "earnings_history_pe").unavailableReason).toContain("need 3");
    expect(fewYears.assumptions.lookAheadSafe).toBe(false);
  });

  it("turns NaN and Infinity into unavailable numbers rather than propagating them", () => {
    const nan = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: Number.NaN, equity: Number.NaN, shares: Number.NaN })],
      peers: peers(5, { eps: Number.NaN, close: Number.NaN }),
    });
    expect(nan.confidence).toBe("UNAVAILABLE");
    expect(method(nan, "earnings_peer_pe").methodValue).toBeNull();
    assertFiniteNumbers(nan);

    const infinite = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: Number.POSITIVE_INFINITY, equity: 100, shares: 10 })],
      peers: [
        ...peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: null }),
        peer({ ticker: "INF", close: Number.POSITIVE_INFINITY, eps: 1, dividendPerShare: null }),
      ],
    });
    expect(method(infinite, "earnings_peer_pe").available).toBe(false);
    expect(method(infinite, "earnings_peer_pe").unavailableReason).toContain("EPS is unavailable");
    expect(method(infinite, "book_peer_pb").available).toBe(true);
    expect(method(infinite, "book_peer_pb").medianMultiple).toBe(2);
    assertFiniteNumbers(infinite);
  });

  it("lowers confidence for VERY_STALE filings without changing the estimate", () => {
    const shared = {
      periodsEps: 1,
      peers: peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: null }),
    };
    const fresh = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: shared.periodsEps, equity: 100, shares: 10 })],
      peers: shared.peers,
    });
    const stale = value({
      periods: [annual({ periodEnd: "2019-01-31", eps: shared.periodsEps, equity: 100, shares: 10 })],
      peers: shared.peers,
    });
    expect(fresh.assumptions.freshness).toBe("FRESH");
    expect(fresh.confidence).toBe("MEDIUM");
    expect(stale.assumptions.freshness).toBe("VERY_STALE");
    expect(stale.confidence).toBe("LOW");
    expect(stale.fairValueBase).toBe(fresh.fairValueBase);
    expect(stale.fairValueLow).toBe(fresh.fairValueLow);
    expect(stale.fairValueHigh).toBe(fresh.fairValueHigh);
  });

  it("can reach HIGH on FRESH or AGING data when at least three methods clear", () => {
    const inputs = {
      periodsFields: { eps: 1, equity: 70, shares: 10, dividendPerShare: 1.5 },
      peers: peers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.5 }),
    };
    const fresh = value({
      periods: [annual({ periodEnd: "2025-12-31", ...inputs.periodsFields })],
      peers: inputs.peers,
    });
    const aging = value({
      periods: [annual({ periodEnd: "2024-06-30", ...inputs.periodsFields })],
      peers: inputs.peers,
    });
    expect(fresh.assumptions.freshness).toBe("FRESH");
    expect(fresh.confidence).toBe("HIGH");
    expect(aging.assumptions.freshness).toBe("AGING");
    expect(aging.confidence).toBe("HIGH");
    expect(aging.fairValueBase).toBe(fresh.fairValueBase);
  });

  it("does not calculate BANK, REIT, OTHER_FINANCIAL, or UNKNOWN", () => {
    for (const profile of ["BANK", "REIT", "OTHER_FINANCIAL", "UNKNOWN"] as const) {
      const result = value({
        profile,
        periods: [annual({ periodEnd: "2025-12-31", eps: 2, equity: 100, shares: 10, dividendPerShare: 0.4 })],
        peers: peers(6),
      });
      expect(result.confidence).toBe("UNAVAILABLE");
      expect(result.fairValueBase).toBeNull();
      expect(result.methods).toEqual([]);
      expect(result.unavailableReason).toContain(profile);
      expect(result.unavailableReason).toContain("GENERAL");
    }
  });

  it("leaves Research Score and Valuation Score unchanged", () => {
    const config = loadScoringConfig();
    function metric(id: string, metricValue: number | null, available = metricValue !== null): MetricValue {
      return {
        id,
        label: id,
        value: metricValue,
        unit: "ratio",
        available,
        reason: available ? null : "unavailable in fixture",
        period: "2025-12-31",
        inputs: [{ name: id, value: metricValue }],
        formula: id,
      };
    }
    const metrics = [
      metric("price_to_earnings", 8),
      metric("dividend_yield", 0.06),
      metric("roe", 0.18),
      metric("net_margin", 0.2),
      metric("revenue_cagr", 0.1),
      metric("pat_cagr", 0.1),
    ];
    const before = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      ticker: "ACME",
      researchProfile: "GENERAL",
      metrics,
      asOf: AS_OF,
    });
    const fair = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1 })],
      peers: peers(5, { close: 12, eps: 1, dividendPerShare: null, equity: null, shares: null }),
    });
    const after = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      ticker: "ACME",
      researchProfile: "GENERAL",
      metrics,
      asOf: AS_OF,
    });
    expect(after.researchScore).toBe(before.researchScore);
    expect(after.valuationScore).toBe(before.valuationScore);
    expect(after.valuationScore).not.toBe(fair.fairValueBase);
    expect(method(fair, "earnings_peer_pe").medianMultiple).toBe(12);
    expect(method(fair, "earnings_peer_pe").medianMultiple).not.toBe(8);
    expect(method(fair, "earnings_peer_pe").medianMultiple).not.toBe(25);

    const scoreSource = readFileSync("src/scoring/score.ts", "utf8");
    const runnerSource = readFileSync("src/scoring/run-ticker.ts", "utf8");
    const pageSource = readFileSync("src/app/stock/[ticker]/page.tsx", "utf8");
    const fairSource = readFileSync("src/fair-value/calculate.ts", "utf8");
    expect(scoreSource).not.toContain("fair-value");
    expect(runnerSource).not.toContain("fair-value");
    expect(pageSource).toContain("loadFairValueForPage");
    expect(pageSource).not.toContain("calculateGeneralFairValue");
    expect(pageSource).not.toContain("persistFairValueRun");
    expect(fairSource).not.toContain("yahoo");
    expect(fairSource).not.toContain("loadScoringConfig");
    expect(fairSource.toLowerCase()).not.toContain("upside");
    expect(fairSource.toLowerCase()).not.toContain("downside");
  });

  it("appends an auditable row and does not write on a read-only snapshot", () => {
    const sqlite = new Database(":memory:");
    migrateSqliteSchema(sqlite);
    const cols = (sqlite.pragma("table_info(fair_value_runs)") as { name: string }[]).map((col) => col.name);
    expect(cols).toEqual([
      "id",
      "instrument_id",
      "ticker",
      "research_profile",
      "model_version",
      "valuation_date",
      "fundamentals_period_end",
      "current_price",
      "fair_value_low",
      "fair_value_base",
      "fair_value_high",
      "difference_vs_price",
      "confidence",
      "methods_json",
      "assumptions_json",
      "unavailable_reason",
      "calculated_at",
    ]);
    const instrument = sqlite
      .prepare(
        `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
         VALUES ('ACME', 'Acme', 'COMMON_STOCK', '2026-01-01', '2026-01-01')`,
      )
      .run();
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      peers: peers(5, { close: 10, eps: 1 }),
    });
    const id = insertFairValueRun(sqlite, {
      instrumentId: Number(instrument.lastInsertRowid),
      result,
      calculatedAt: "2026-09-28T01:00:00.000Z",
    });
    insertFairValueRun(sqlite, {
      instrumentId: Number(instrument.lastInsertRowid),
      result,
      calculatedAt: "2026-09-28T02:00:00.000Z",
    });
    const rows = sqlite
      .prepare(
        `SELECT fair_value_base, confidence, methods_json, assumptions_json, calculated_at
         FROM fair_value_runs ORDER BY id`,
      )
      .all() as {
      fair_value_base: number;
      confidence: string;
      methods_json: string;
      assumptions_json: string;
      calculated_at: string;
    }[];
    expect(id).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fair_value_base).toBe(20);
    expect(rows[0]?.confidence).toBe("LOW");
    expect(rows[1]?.calculated_at).toBe("2026-09-28T02:00:00.000Z");
    const storedMethods = JSON.parse(rows[0]!.methods_json) as { id: string; medianMultiple: number | null }[];
    expect(storedMethods.find((row) => row.id === "earnings_peer_pe")?.medianMultiple).toBe(10);
    const assumptions = JSON.parse(rows[0]!.assumptions_json) as { yamlScoreBandsUsed: boolean };
    expect(assumptions.yamlScoreBandsUsed).toBe(false);
    sqlite.close();

    const previous = process.env.BURSA_SNAPSHOT_READONLY;
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    try {
      expect(persistFairValueRun({ instrumentId: 1, result, calculatedAt: "2026-09-28T03:00:00.000Z" })).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
      else process.env.BURSA_SNAPSHOT_READONLY = previous;
    }
  });
});
