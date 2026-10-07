import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateSqliteSchema } from "@/db/client";
import { calculateBankFairValue } from "@/fair-value/calculate-bank";
import { calculateGeneralFairValue } from "@/fair-value/calculate";
import { insertFairValueRun } from "@/fair-value/persist";
import { BANK_FAIR_VALUE_MODEL_VERSION, FAIR_VALUE_MODEL_VERSION, type FairValueMethodId, type FairValueResult } from "@/fair-value/types";
import type { MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import { loadScoringConfig } from "@/config/load-scoring";
import { scoreFromMetrics } from "@/scoring/score";
import type { PeerUniverseRow } from "@/scoring/peer-group";

const AS_OF = "2026-09-28T00:00:00.000Z";

function annual(args: {
  periodEnd: string;
  eps?: number | null;
  equity?: number | null;
  shares?: number | null;
  dividendPerShare?: number | null;
  availableAt?: string | null;
  totalDebt?: number | null;
  cash?: number | null;
  ocf?: number | null;
  capex?: number | null;
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
    totalDebt: args.totalDebt ?? null,
    cash: args.cash ?? null,
    ocf: args.ocf ?? null,
    capex: args.capex ?? null,
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
  researchProfile?: ResearchProfile;
  industry?: string | null;
}): PeerUniverseRow {
  return {
    ticker: args.ticker,
    name: args.ticker,
    listingStatus: "listed",
    instrumentType: "COMMON_STOCK",
    researchProfile: args.researchProfile ?? "BANK",
    industry: args.industry === undefined ? "Banks - Regional" : args.industry,
    sector: "Financial Services",
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

function bankPeers(count: number, patch?: Partial<Parameters<typeof peer>[0]>): PeerUniverseRow[] {
  return Array.from({ length: count }, (_, i) => peer({ ticker: `B${i + 1}`, ...patch }));
}

function value(args: {
  profile?: ResearchProfile;
  ticker?: string;
  periods?: StatementSnapshot[];
  bars?: PriceBarSnapshot[];
  peers?: PeerUniverseRow[];
  asOf?: string;
}): FairValueResult {
  return calculateBankFairValue({
    ticker: args.ticker ?? "ACME",
    researchProfile: args.profile ?? "BANK",
    industry: "Banks - Regional",
    sector: "Financial Services",
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

describe("BANK fair value", () => {
  it("prices a bank from all six relative methods and combines them with min, median, and max", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
        annual({ periodEnd: "2024-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
      peers: bankPeers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.4 }),
    });

    expect(result.modelVersion).toBe("bank-relative-v1");
    expect(result.modelVersion).toBe(BANK_FAIR_VALUE_MODEL_VERSION);
    expect(result.researchProfile).toBe("BANK");
    expect(method(result, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(result, "earnings_peer_pe").medianMultiple).toBe(10);
    expect(method(result, "earnings_peer_pe").peerGroup).toContain("BANK profile");
    expect(method(result, "earnings_history_pe").methodValue).toBe(10);
    expect(method(result, "earnings_history_pe").medianMultiple).toBe(10);
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(method(result, "book_peer_pb").medianMultiple).toBe(2);
    expect(method(result, "book_history_pb").methodValue).toBe(10);
    expect(method(result, "book_history_pb").medianMultiple).toBe(1);
    expect(method(result, "dividend_peer_yield").methodValue).toBeCloseTo(12.5);
    expect(method(result, "dividend_peer_yield").medianMultiple).toBeCloseTo(0.04);
    expect(method(result, "dividend_history_yield").methodValue).toBe(10);
    expect(method(result, "dividend_history_yield").medianMultiple).toBeCloseTo(0.05);
    expect(result.methods.filter((row) => row.available)).toHaveLength(6);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBe(10);
    expect(result.fairValueHigh).toBe(20);
    expect(result.differenceVsPrice).toBeCloseTo((10 - 11) / 11);
    expect(result.confidence).toBe("HIGH");
    expect(result.assumptions.peerGroupType).toBe("BANK_PROFILE");
    expect(result.assumptions.yamlScoreBandsUsed).toBe(false);
    expect(result.assumptions.modelDefaultsUsed).toBe(false);
    expect(result.assumptions.lookAheadSafe).toBe(false);
    expect(result.assumptions.historicalValuationStatus).toBe("PERIOD_END_ONLY");
    expect(result.assumptions.historicalLimitation).toContain("not look-ahead-safe");
    expect(method(result, "earnings_history_pe").priceDates).toEqual([
      "2023-12-31",
      "2024-12-31",
      "2025-12-31",
    ]);
  });

  it("leaves historical methods unavailable when price history does not cover three period ends", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
        annual({ periodEnd: "2024-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
      ],
      bars: [bar("2026-09-25", 11)],
      peers: bankPeers(5),
    });
    expect(method(result, "earnings_history_pe").available).toBe(false);
    expect(method(result, "earnings_history_pe").unavailableReason).toContain("need 3");
    expect(method(result, "book_history_pb").available).toBe(false);
    expect(method(result, "dividend_history_yield").available).toBe(false);
    expect(method(result, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(method(result, "dividend_peer_yield").methodValue).toBeCloseTo(12.5);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBeCloseTo(12.5);
    expect(result.fairValueHigh).toBe(20);
    expect(result.confidence).toBe("HIGH");
    expect(result.assumptions.historicalPointCount).toBe(0);
    expect(result.assumptions.historicalLimitation).toBeNull();
  });

  it("does not copy a prior-year DPS into a missing latest DPS", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.4 }),
        annual({ periodEnd: "2024-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: null }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
      peers: bankPeers(5),
    });
    expect(method(result, "dividend_peer_yield").available).toBe(false);
    expect(method(result, "dividend_peer_yield").currentInput).toBeNull();
    expect(method(result, "dividend_peer_yield").methodValue).toBeNull();
    expect(method(result, "dividend_peer_yield").unavailableReason).toContain("not treated as zero");
    expect(method(result, "dividend_history_yield").available).toBe(false);
    expect(method(result, "dividend_history_yield").currentInput).toBeNull();
    expect(method(result, "dividend_history_yield").unavailableReason).toContain("not treated as zero");
    expect(method(result, "earnings_peer_pe").available).toBe(true);
    expect(method(result, "earnings_history_pe").available).toBe(true);
  });

  it("does not copy a prior-year share count into a missing share field", () => {
    const missingLatest = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1, equity: 80, shares: 10 }),
        annual({ periodEnd: "2024-12-31", eps: 1, equity: 90, shares: 10 }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: null }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
      peers: bankPeers(5),
    });
    expect(method(missingLatest, "book_peer_pb").available).toBe(false);
    expect(method(missingLatest, "book_peer_pb").unavailableReason).toBe("Shares are unavailable");
    expect(method(missingLatest, "book_history_pb").available).toBe(false);
    expect(method(missingLatest, "book_history_pb").unavailableReason).toBe("Shares are unavailable");
    expect(method(missingLatest, "book_history_pb").methodValue).toBeNull();
    expect(method(missingLatest, "earnings_history_pe").available).toBe(true);

    const missingHistory = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1, equity: 80, shares: null }),
        annual({ periodEnd: "2024-12-31", eps: 1, equity: 90, shares: null }),
        annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
      peers: bankPeers(5, { dividendPerShare: null }),
    });
    expect(method(missingHistory, "book_peer_pb").methodValue).toBe(20);
    expect(method(missingHistory, "book_history_pb").available).toBe(false);
    expect(method(missingHistory, "book_history_pb").unavailableReason).toContain("need 3");
    expect(method(missingHistory, "book_history_pb").historicalSampleCount).toBe(1);
    expect(method(missingHistory, "earnings_history_pe").available).toBe(true);
  });

  it("refuses peer methods below 5 usable BANK names and does not fall back to the whole market", () => {
    const few = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 })],
      peers: bankPeers(4),
    });
    expect(method(few, "earnings_peer_pe").available).toBe(false);
    expect(method(few, "book_peer_pb").available).toBe(false);
    expect(method(few, "dividend_peer_yield").available).toBe(false);
    expect(method(few, "earnings_peer_pe").unavailableReason).toContain("5");
    expect(method(few, "earnings_peer_pe").unavailableReason).toContain("Whole Bursa is not used");
    expect(few.confidence).toBe("UNAVAILABLE");
    expect(few.assumptions.peerGroupType).toBe("NONE");

    const generalPeers = Array.from({ length: 8 }, (_, i) =>
      peer({
        ticker: `G${i + 1}`,
        researchProfile: "GENERAL",
        industry: "Widgets - Industrial",
      }),
    );
    const wrongProfile = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 })],
      peers: [...bankPeers(4), ...generalPeers],
    });
    expect(method(wrongProfile, "earnings_peer_pe").available).toBe(false);
    expect(wrongProfile.assumptions.peerEligibleCount).toBe(4);
    expect(wrongProfile.fairValueBase).toBeNull();
  });

  it("drops non-finite, zero, and negative inputs instead of pricing them", () => {
    const negative = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: -1, equity: -50, shares: 10, dividendPerShare: -0.2 })],
      peers: bankPeers(5),
    });
    expect(method(negative, "earnings_peer_pe").unavailableReason).toContain("zero or negative");
    expect(method(negative, "book_peer_pb").unavailableReason).toContain("Book value per share");
    expect(method(negative, "dividend_peer_yield").unavailableReason).toContain("zero or negative");
    expect(negative.confidence).toBe("UNAVAILABLE");

    const zeroShares = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 0 })],
      peers: bankPeers(5, { dividendPerShare: null }),
    });
    expect(method(zeroShares, "book_peer_pb").unavailableReason).toContain("zero or negative");
    expect(method(zeroShares, "earnings_peer_pe").available).toBe(true);

    const nan = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: Number.NaN, equity: Number.NaN, shares: Number.NaN, dividendPerShare: Number.NaN })],
      peers: bankPeers(5, { eps: Number.NaN, close: Number.NaN, equity: Number.NaN, shares: Number.NaN, dividendPerShare: Number.NaN }),
    });
    expect(nan.confidence).toBe("UNAVAILABLE");
    expect(method(nan, "earnings_peer_pe").methodValue).toBeNull();
    assertFiniteNumbers(nan);

    const infinite = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: Number.POSITIVE_INFINITY, equity: 100, shares: 10 })],
      peers: [
        ...bankPeers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: null }),
        peer({ ticker: "INF", close: Number.POSITIVE_INFINITY, eps: 1, dividendPerShare: null }),
      ],
    });
    expect(method(infinite, "earnings_peer_pe").unavailableReason).toContain("EPS is unavailable");
    expect(method(infinite, "book_peer_pb").available).toBe(true);
    expect(method(infinite, "book_peer_pb").medianMultiple).toBe(2);
    assertFiniteNumbers(infinite);
  });

  it("keeps low and high null for one method and uses min, median, and max for two", () => {
    const one = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      peers: bankPeers(5, { close: 10, eps: 1, equity: null, shares: null, dividendPerShare: null }),
    });
    expect(method(one, "earnings_peer_pe").methodValue).toBe(20);
    expect(one.fairValueBase).toBe(20);
    expect(one.fairValueLow).toBeNull();
    expect(one.fairValueHigh).toBeNull();
    expect(one.differenceVsPrice).toBeCloseTo((20 - 11) / 11);
    expect(one.confidence).toBe("LOW");

    const two = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10 })],
      peers: bankPeers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: null }),
    });
    expect(method(two, "earnings_peer_pe").methodValue).toBe(10);
    expect(method(two, "book_peer_pb").methodValue).toBe(20);
    expect(two.fairValueLow).toBe(10);
    expect(two.fairValueBase).toBe(15);
    expect(two.fairValueHigh).toBe(20);
    expect(two.confidence).toBe("MEDIUM");
  });

  it("labels confidence from method count and freshness without a numerical score", () => {
    const inputs = { eps: 1, equity: 70, shares: 10, dividendPerShare: 1.5 };
    const peers = bankPeers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.5 });
    const fresh = value({
      periods: [annual({ periodEnd: "2025-12-31", ...inputs })],
      peers,
    });
    const aging = value({
      periods: [annual({ periodEnd: "2024-06-30", ...inputs })],
      peers,
    });
    const stale = value({
      periods: [annual({ periodEnd: "2023-06-30", ...inputs })],
      peers,
    });
    const veryStale = value({
      periods: [annual({ periodEnd: "2019-01-31", ...inputs })],
      peers,
    });
    const none = value({
      periods: [annual({ periodEnd: "2025-12-31" })],
      peers: bankPeers(2),
    });

    expect(fresh.assumptions.freshness).toBe("FRESH");
    expect(fresh.confidence).toBe("HIGH");
    expect(aging.assumptions.freshness).toBe("AGING");
    expect(aging.confidence).toBe("HIGH");
    expect(aging.fairValueBase).toBe(fresh.fairValueBase);
    expect(stale.assumptions.freshness).toBe("STALE");
    expect(stale.confidence).toBe("LOW");
    expect(stale.fairValueBase).toBe(fresh.fairValueBase);
    expect(veryStale.assumptions.freshness).toBe("VERY_STALE");
    expect(veryStale.confidence).toBe("LOW");
    expect(veryStale.fairValueLow).toBe(fresh.fairValueLow);
    expect(veryStale.fairValueHigh).toBe(fresh.fairValueHigh);
    expect(none.confidence).toBe("UNAVAILABLE");
    expect(none.fairValueBase).toBeNull();
    expect(JSON.stringify(fresh)).not.toMatch(/"confidenceScore"/);
  });

  it("keeps period-end evidence when only some filings have available_at", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", eps: 1 }),
        annual({ periodEnd: "2024-12-31", eps: 1 }),
        annual({ periodEnd: "2025-12-31", availableAt: "2026-02-28", eps: 1 }),
      ],
      bars: [
        bar("2023-12-31", 8),
        bar("2024-12-31", 10),
        bar("2025-12-31", 12),
        bar("2026-09-25", 11),
      ],
    });
    expect(result.assumptions.lookAheadSafe).toBe(false);
    expect(result.assumptions.historicalValuationStatus).toBe("PERIOD_END_ONLY");
    expect(result.assumptions.historicalLimitation).toContain("not look-ahead-safe");
    expect(method(result, "earnings_history_pe").lookAheadSafe).toBe(false);
  });

  it("ignores debt, cash, operating cash flow, and capex", () => {
    const shared = {
      bars: [bar("2026-09-25", 11)],
      peers: bankPeers(5, { dividendPerShare: null }),
    };
    const plain = value({
      ...shared,
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10 })],
    });
    const withBalanceSheet = value({
      ...shared,
      periods: [
        annual({
          periodEnd: "2025-12-31",
          eps: 1,
          equity: 100,
          shares: 10,
          totalDebt: 1_000_000_000_000,
          cash: 1,
          ocf: -50,
          capex: -80,
        }),
      ],
    });
    expect(withBalanceSheet.fairValueBase).toBe(plain.fairValueBase);
    expect(withBalanceSheet.fairValueLow).toBe(plain.fairValueLow);
    expect(withBalanceSheet.fairValueHigh).toBe(plain.fairValueHigh);
    expect(withBalanceSheet.methods.map((row) => row.methodValue)).toEqual(
      plain.methods.map((row) => row.methodValue),
    );
  });

  it("calculates BANK only", () => {
    for (const profile of ["GENERAL", "REIT", "OTHER_FINANCIAL", "UNKNOWN"] as const) {
      const result = value({
        profile,
        periods: [annual({ periodEnd: "2025-12-31", eps: 2, equity: 100, shares: 10, dividendPerShare: 0.4 })],
        peers: bankPeers(6),
      });
      expect(result.confidence).toBe("UNAVAILABLE");
      expect(result.fairValueBase).toBeNull();
      expect(result.methods).toEqual([]);
      expect(result.modelVersion).toBe("bank-relative-v1");
      expect(result.unavailableReason).toContain(profile);
      expect(result.unavailableReason).toContain("BANK");
    }
  });

  it("stores bank rows on the existing append-only path with bank-relative-v1", () => {
    const sqlite = new Database(":memory:");
    migrateSqliteSchema(sqlite);
    const instrument = sqlite
      .prepare(
        `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
         VALUES ('ACME', 'Acme Bank', 'COMMON_STOCK', '2026-01-01', '2026-01-01')`,
      )
      .run();
    const bank = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      peers: bankPeers(5, { close: 10, eps: 1, dividendPerShare: null, equity: null, shares: null }),
    });
    const general = calculateGeneralFairValue({
      ticker: "ACME",
      researchProfile: "GENERAL",
      industry: "Widgets - Industrial",
      sector: "Industrials",
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: bankPeers(5, {
        close: 10,
        eps: 1,
        dividendPerShare: null,
        equity: null,
        shares: null,
        researchProfile: "GENERAL",
        industry: "Widgets - Industrial",
      }),
      asOf: AS_OF,
    });
    insertFairValueRun(sqlite, {
      instrumentId: Number(instrument.lastInsertRowid),
      result: bank,
      calculatedAt: "2026-09-28T01:00:00.000Z",
    });
    insertFairValueRun(sqlite, {
      instrumentId: Number(instrument.lastInsertRowid),
      result: general,
      calculatedAt: "2026-09-28T02:00:00.000Z",
    });
    const rows = sqlite
      .prepare(`SELECT model_version, research_profile, fair_value_base FROM fair_value_runs ORDER BY id`)
      .all() as { model_version: string; research_profile: string; fair_value_base: number }[];
    expect(rows).toEqual([
      { model_version: "bank-relative-v1", research_profile: "BANK", fair_value_base: 20 },
      { model_version: "general-relative-v1", research_profile: "GENERAL", fair_value_base: 20 },
    ]);
    sqlite.close();
  });

  it("leaves GENERAL Fair Value, Research Score, and Valuation Score unchanged", () => {
    const generalPeers = Array.from({ length: 5 }, (_, i) =>
      peer({
        ticker: `P${i + 1}`,
        close: 10,
        eps: 1,
        dividendPerShare: null,
        equity: null,
        shares: null,
        researchProfile: "GENERAL",
        industry: "Widgets - Industrial",
      }),
    );
    const generalArgs = {
      ticker: "ACME",
      researchProfile: "GENERAL" as const,
      industry: "Widgets - Industrial",
      sector: "Industrials",
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: generalPeers,
      asOf: AS_OF,
    };
    const before = calculateGeneralFairValue(generalArgs);
    const bankOnGeneral = calculateBankFairValue(generalArgs);
    const after = calculateGeneralFairValue(generalArgs);
    expect(before.modelVersion).toBe(FAIR_VALUE_MODEL_VERSION);
    expect(before.modelVersion).toBe("general-relative-v1");
    expect(before.fairValueBase).toBe(20);
    expect(before.fairValueLow).toBeNull();
    expect(before.fairValueHigh).toBeNull();
    expect(before.confidence).toBe("LOW");
    expect(after).toEqual(before);
    expect(bankOnGeneral.confidence).toBe("UNAVAILABLE");
    expect(bankOnGeneral.methods).toEqual([]);
    expect(bankOnGeneral.modelVersion).toBe("bank-relative-v1");

    const rejectedBank = calculateGeneralFairValue({
      ...generalArgs,
      researchProfile: "BANK",
      peers: bankPeers(6),
    });
    expect(rejectedBank.confidence).toBe("UNAVAILABLE");
    expect(rejectedBank.methods).toEqual([]);
    expect(rejectedBank.modelVersion).toBe("general-relative-v1");
    expect(rejectedBank.unavailableReason).toContain("BANK");
    expect(rejectedBank.unavailableReason).toContain("GENERAL");

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
    const bankMetrics = [
      metric("price_to_book", 1.1),
      metric("dividend_yield", 0.04),
      metric("roe", 0.12),
      metric("revenue_cagr", 0.08),
      metric("pat_cagr", 0.08),
    ];
    const scoreBefore = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      ticker: "ACME",
      researchProfile: "BANK",
      metrics: bankMetrics,
      asOf: AS_OF,
    });
    const fair = value({
      periods: [annual({ periodEnd: "2025-12-31", eps: 1, equity: 100, shares: 10, dividendPerShare: 0.5 })],
      peers: bankPeers(5, { close: 10, eps: 1, equity: 50, shares: 10, dividendPerShare: 0.4 }),
    });
    const scoreAfter = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      ticker: "ACME",
      researchProfile: "BANK",
      metrics: bankMetrics,
      asOf: AS_OF,
    });
    expect(scoreAfter.researchScore).toBe(scoreBefore.researchScore);
    expect(scoreAfter.valuationScore).toBe(scoreBefore.valuationScore);
    expect(scoreAfter.valuationScore).not.toBe(fair.fairValueBase);
    expect(method(fair, "book_peer_pb").medianMultiple).toBe(2);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(0.9);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(2.2);
    expect(method(fair, "dividend_peer_yield").medianMultiple).toBeCloseTo(0.04);
    expect(method(fair, "dividend_peer_yield").medianMultiple).not.toBe(0.06);
    expect(method(fair, "dividend_peer_yield").medianMultiple).not.toBe(0.02);

    const scoreSource = readFileSync("src/scoring/score.ts", "utf8");
    const runnerSource = readFileSync("src/scoring/run-ticker.ts", "utf8");
    const pageSource = readFileSync("src/app/stock/[ticker]/page.tsx", "utf8");
    const dailySource = readFileSync("src/refresh/daily.ts", "utf8");
    const generalSource = readFileSync("src/fair-value/calculate.ts", "utf8");
    const bankSource = readFileSync("src/fair-value/calculate-bank.ts", "utf8");
    expect(scoreSource).not.toContain("fair-value");
    expect(runnerSource).not.toContain("fair-value");
    expect(pageSource).toContain("loadFairValueForPage");
    expect(pageSource).not.toContain("calculateBankFairValue");
    expect(pageSource).not.toContain("persistFairValueRun");
    expect(dailySource).not.toContain("fair-value");
    expect(dailySource).not.toContain("calculateBankFairValue");
    expect(generalSource).not.toContain("bank-relative");
    expect(generalSource).not.toContain("calculateBankFairValue");
    expect(bankSource).not.toContain("yahoo");
    expect(bankSource).not.toContain("loadScoringConfig");
    expect(bankSource.toLowerCase()).not.toContain("nim");
    expect(bankSource.toLowerCase()).not.toContain("cet1");
    expect(bankSource.toLowerCase()).not.toContain("ebitda");
    expect(bankSource.toLowerCase()).not.toContain("residual");
    expect(bankSource.toLowerCase()).not.toContain("discount");
  });
});
