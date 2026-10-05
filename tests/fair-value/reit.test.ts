import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateSqliteSchema } from "@/db/client";
import { calculateBankFairValue } from "@/fair-value/calculate-bank";
import { calculateGeneralFairValue } from "@/fair-value/calculate";
import { calculateReitFairValue } from "@/fair-value/calculate-reit";
import { insertFairValueRun, persistFairValueRun } from "@/fair-value/persist";
import {
  BANK_FAIR_VALUE_MODEL_VERSION,
  FAIR_VALUE_MODEL_VERSION,
  REIT_FAIR_VALUE_MODEL_VERSION,
  type FairValueMethodId,
  type FairValueResult,
} from "@/fair-value/types";
import { loadScoringConfig } from "@/config/load-scoring";
import type { MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import { scoreFromMetrics } from "@/scoring/score";
import type { PeerUniverseRow } from "@/scoring/peer-group";

const AS_OF = "2026-09-28T00:00:00.000Z";

function annual(args: {
  periodEnd: string;
  equity?: number | null;
  shares?: number | null;
  eps?: number | null;
  dividendPerShare?: number | null;
  navPerShare?: number | null;
  totalDebt?: number | null;
  cash?: number | null;
  ocf?: number | null;
  capex?: number | null;
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
    totalDebt: args.totalDebt ?? null,
    cash: args.cash ?? null,
    ocf: args.ocf ?? null,
    capex: args.capex ?? null,
    shares: args.shares ?? null,
    dividendPerShare: args.dividendPerShare ?? null,
    navPerShare: args.navPerShare ?? null,
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
  equity?: number | null;
  shares?: number | null;
  eps?: number | null;
  dividendPerShare?: number | null;
  researchProfile?: ResearchProfile;
  industry?: string | null;
}): PeerUniverseRow {
  return {
    ticker: args.ticker,
    name: args.ticker,
    listingStatus: "listed",
    instrumentType: "REIT",
    researchProfile: args.researchProfile ?? "REIT",
    industry: args.industry === undefined ? "REIT - Diversified" : args.industry,
    sector: "Real Estate",
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

function reitPeers(count: number, patch?: Partial<Parameters<typeof peer>[0]>): PeerUniverseRow[] {
  return Array.from({ length: count }, (_, i) => peer({ ticker: `R${i + 1}`, ...patch }));
}

function value(args: {
  profile?: ResearchProfile;
  ticker?: string;
  periods?: StatementSnapshot[];
  bars?: PriceBarSnapshot[];
  peers?: PeerUniverseRow[];
  asOf?: string;
  industry?: string | null;
}): FairValueResult {
  return calculateReitFairValue({
    ticker: args.ticker ?? "ACME",
    researchProfile: args.profile ?? "REIT",
    industry: args.industry === undefined ? "REIT - Retail" : args.industry,
    sector: "Real Estate",
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

function historyBars(): PriceBarSnapshot[] {
  return [
    bar("2023-12-31", 8),
    bar("2024-12-31", 10),
    bar("2025-12-31", 12),
    bar("2026-09-25", 11),
  ];
}

describe("REIT fair value", () => {
  it("prices accounting book at the REIT peer median P/B and excludes the subject", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: [
        ...reitPeers(5, { close: 10, equity: 50, shares: 10 }),
        peer({ ticker: "ACME", close: 100, equity: 10, shares: 10 }),
      ],
    });
    const row = method(result, "book_peer_pb");
    expect(result.methods.map((item) => item.id)).toEqual(["book_peer_pb", "book_history_pb"]);
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBe(2);
    expect(row.methodValue).toBe(20);
    expect(row.peerCount).toBe(5);
    expect(row.formula).toBe("book value per share × peer median P/B");
    expect(row.peerGroup).toContain("REIT profile");
    expect(row.label).not.toMatch(/NAV/);
    expect(result.modelVersion).toBe("reit-relative-v1");
    expect(result.modelVersion).toBe(REIT_FAIR_VALUE_MODEL_VERSION);
    expect(result.assumptions.peerGroupType).toBe("REIT_PROFILE");
    expect(result.assumptions.peerEligibleCount).toBe(5);
    expect(result.assumptions.yamlScoreBandsUsed).toBe(false);
    expect(result.assumptions.modelDefaultsUsed).toBe(false);
    expect(result.assumptions.excludedApproaches).toContain("reported NAV");
    expect(result.assumptions.excludedApproaches).toContain("DPU");
    expect(result.assumptions.excludedApproaches).toContain("P/E");
    expect(result.fairValueBase).toBe(20);
    expect(result.fairValueLow).toBeNull();
    expect(result.fairValueHigh).toBeNull();
    expect(result.confidence).toBe("LOW");
    expect(result.confidence).not.toBe("HIGH");
  });

  it("prices accounting book at the own-history median P/B", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
      ],
      bars: historyBars(),
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    const row = method(result, "book_history_pb");
    expect(row.available).toBe(true);
    expect(row.medianMultiple).toBe(1);
    expect(row.methodValue).toBe(10);
    expect(row.historicalSampleCount).toBe(3);
    expect(row.historicalPeriodEnds).toEqual(["2023-12-31", "2024-12-31", "2025-12-31"]);
    expect(row.priceDates).toEqual(["2023-12-31", "2024-12-31", "2025-12-31"]);
    expect(row.lookAheadSafe).toBe(false);
  });

  it("uses min, median, and max for two book methods and does not reach HIGH", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
      ],
      bars: historyBars(),
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(method(result, "book_history_pb").methodValue).toBe(10);
    expect(result.fairValueLow).toBe(10);
    expect(result.fairValueBase).toBe(15);
    expect(result.fairValueHigh).toBe(20);
    expect(result.differenceVsPrice).toBeCloseTo((15 - 11) / 11);
    expect(result.confidence).toBe("MEDIUM");
    expect(result.confidence).not.toBe("HIGH");
  });

  it("keeps min, median, and max when peer and history book disagree widely", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
      ],
      bars: [
        bar("2023-12-31", 4),
        bar("2024-12-31", 5),
        bar("2025-12-31", 6),
        bar("2026-09-25", 11),
      ],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(method(result, "book_history_pb").methodValue).toBe(5);
    expect(result.fairValueLow).toBe(5);
    expect(result.fairValueBase).toBe(12.5);
    expect(result.fairValueHigh).toBe(20);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("refuses a peer method below 5 REIT names and does not use other profiles", () => {
    const few = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: reitPeers(4),
    });
    expect(method(few, "book_peer_pb").available).toBe(false);
    expect(method(few, "book_peer_pb").unavailableReason).toContain("5");
    expect(method(few, "book_peer_pb").unavailableReason).toContain("Whole Bursa is not used");
    expect(few.assumptions.peerGroupType).toBe("NONE");
    expect(few.confidence).toBe("UNAVAILABLE");

    const wrongProfile = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: [
        ...reitPeers(4),
        ...Array.from({ length: 8 }, (_, i) =>
          peer({
            ticker: `G${i + 1}`,
            researchProfile: "GENERAL",
            industry: "Widgets - Industrial",
          }),
        ),
      ],
      industry: "REIT - Office",
    });
    expect(method(wrongProfile, "book_peer_pb").available).toBe(false);
    expect(wrongProfile.assumptions.peerEligibleCount).toBe(4);
    expect(wrongProfile.assumptions.peerSelectionPath).not.toContain("Office");
  });

  it("leaves historical book unavailable below 3 period-end observations", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
      ],
      bars: [bar("2024-12-31", 10), bar("2025-12-31", 12), bar("2026-09-25", 11)],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(method(result, "book_history_pb").available).toBe(false);
    expect(method(result, "book_history_pb").unavailableReason).toContain("need 3");
    expect(method(result, "book_peer_pb").methodValue).toBe(20);
    expect(result.fairValueBase).toBe(20);
    expect(result.fairValueLow).toBeNull();
    expect(result.confidence).toBe("LOW");
  });

  it("does not price missing, zero, negative, or non-finite equity or shares", () => {
    const missingEquity = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: null, shares: 10 })],
      peers: reitPeers(5),
    });
    expect(method(missingEquity, "book_peer_pb").unavailableReason).toBe("Equity is unavailable");

    const missingShares = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: null })],
      peers: reitPeers(5),
    });
    expect(method(missingShares, "book_peer_pb").unavailableReason).toBe("Shares are unavailable");

    const zeroEquity = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 0, shares: 10 })],
      peers: reitPeers(5),
    });
    expect(method(zeroEquity, "book_peer_pb").unavailableReason).toContain("zero or negative");

    const negativeEquity = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: -50, shares: 10 })],
      peers: reitPeers(5),
    });
    expect(method(negativeEquity, "book_peer_pb").unavailableReason).toContain("zero or negative");

    const zeroShares = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 0 })],
      peers: reitPeers(5),
    });
    expect(method(zeroShares, "book_peer_pb").unavailableReason).toContain("Shares are zero or negative");

    const nan = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: Number.NaN, shares: Number.NaN })],
      peers: reitPeers(5, { equity: Number.NaN, shares: Number.NaN, close: Number.NaN }),
    });
    expect(nan.confidence).toBe("UNAVAILABLE");
    expect(method(nan, "book_peer_pb").methodValue).toBeNull();
    assertFiniteNumbers(nan);

    const infinite = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: Number.POSITIVE_INFINITY, shares: 10 })],
      peers: [
        ...reitPeers(5, { close: 10, equity: 50, shares: 10 }),
        peer({ ticker: "INF", close: Number.POSITIVE_INFINITY, equity: 50, shares: 10 }),
      ],
    });
    expect(method(infinite, "book_peer_pb").unavailableReason).toBe("Equity is unavailable");
    assertFiniteNumbers(infinite);
  });

  it("does not copy an older share count into a missing latest share count", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 80, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 90, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: null }),
      ],
      bars: historyBars(),
      peers: reitPeers(5),
    });
    expect(method(result, "book_peer_pb").available).toBe(false);
    expect(method(result, "book_peer_pb").unavailableReason).toBe("Shares are unavailable");
    expect(method(result, "book_history_pb").available).toBe(false);
    expect(method(result, "book_history_pb").methodValue).toBeNull();
    expect(method(result, "book_history_pb").unavailableReason).toBe("Shares are unavailable");
    expect(result.fairValueBase).toBeNull();
  });

  it("counts a repeated annual period end once", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 200, shares: 10 }),
      ],
      bars: [bar("2024-12-31", 10), bar("2025-12-31", 12), bar("2026-09-25", 11)],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(method(result, "book_history_pb").historicalSampleCount).toBe(2);
    expect(method(result, "book_history_pb").available).toBe(false);
    expect(method(result, "book_history_pb").historicalPeriodEnds).toEqual(["2024-12-31", "2025-12-31"]);
  });

  it("does not create a NAV or distribution method from navPerShare or dividendPerShare", () => {
    const shared = {
      bars: [bar("2026-09-25", 11)],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10, dividendPerShare: 1 }),
    };
    const plain = value({
      ...shared,
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
    });
    const withExcludedFields = value({
      ...shared,
      periods: [
        annual({
          periodEnd: "2024-12-31",
          equity: 90,
          shares: 10,
          dividendPerShare: 0.5,
          navPerShare: 9,
        }),
        annual({
          periodEnd: "2025-12-31",
          equity: 100,
          shares: 10,
          dividendPerShare: null,
          navPerShare: null,
          eps: 4,
          totalDebt: 1_000_000_000,
          cash: 1,
          ocf: -20,
          capex: -30,
        }),
      ],
    });
    expect(withExcludedFields.fairValueBase).toBe(plain.fairValueBase);
    expect(withExcludedFields.methods.map((row) => row.id)).toEqual(["book_peer_pb", "book_history_pb"]);
    expect(withExcludedFields.methods.every((row) => row.formula === "book value per share × peer median P/B" || row.formula === "book value per share × own historical median P/B")).toBe(true);
    expect(withExcludedFields.methods.every((row) => row.currentInputName === "book_value_per_share")).toBe(true);
  });

  it("records period-end-only evidence when filing dates are missing", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2024-12-31", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", equity: 100, shares: 10, availableAt: "2026-02-28" }),
      ],
      bars: historyBars(),
    });
    expect(result.assumptions.lookAheadSafe).toBe(false);
    expect(result.assumptions.historicalValuationStatus).toBe("PERIOD_END_ONLY");
    expect(result.assumptions.historicalLimitation).toContain("not look-ahead-safe");
    expect(method(result, "book_history_pb").lookAheadSafe).toBe(false);
    expect(result.confidence).not.toBe("UNAVAILABLE");
  });

  it("marks history look-ahead-safe only when every annual has available_at", () => {
    const result = value({
      periods: [
        annual({ periodEnd: "2023-12-31", availableAt: "2024-02-28", equity: 100, shares: 10 }),
        annual({ periodEnd: "2024-12-31", availableAt: "2025-02-28", equity: 100, shares: 10 }),
        annual({ periodEnd: "2025-12-31", availableAt: "2026-02-28", equity: 100, shares: 10 }),
      ],
      bars: [
        bar("2024-02-28", 8),
        bar("2025-02-28", 10),
        bar("2026-02-28", 12),
        bar("2026-09-25", 11),
      ],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(result.assumptions.lookAheadSafe).toBe(true);
    expect(result.assumptions.historicalValuationStatus).toBe("POINT_IN_TIME_SAFE");
    expect(method(result, "book_history_pb").lookAheadSafe).toBe(true);
  });

  it("lowers confidence for VERY_STALE filings without changing the estimate", () => {
    const periodsFor = (ends: [string, string, string]) =>
      ends.map((periodEnd) => annual({ periodEnd, equity: 100, shares: 10 }));
    const barsFor = (ends: [string, string, string]) => [
      bar(ends[0], 8),
      bar(ends[1], 10),
      bar(ends[2], 12),
      bar("2026-09-25", 11),
    ];
    const peers = reitPeers(5, { close: 10, equity: 50, shares: 10 });
    const fresh = value({
      periods: periodsFor(["2023-12-31", "2024-12-31", "2025-12-31"]),
      bars: barsFor(["2023-12-31", "2024-12-31", "2025-12-31"]),
      peers,
    });
    const stale = value({
      periods: periodsFor(["2017-01-31", "2018-01-31", "2019-01-31"]),
      bars: barsFor(["2017-01-31", "2018-01-31", "2019-01-31"]),
      peers,
    });
    expect(fresh.assumptions.freshness).toBe("FRESH");
    expect(fresh.confidence).toBe("MEDIUM");
    expect(stale.assumptions.freshness).toBe("VERY_STALE");
    expect(stale.confidence).toBe("LOW");
    expect(stale.fairValueBase).toBe(fresh.fairValueBase);
    expect(stale.fairValueLow).toBe(fresh.fairValueLow);
    expect(stale.fairValueHigh).toBe(fresh.fairValueHigh);
  });

  it("requires a positive current price for the peer method", () => {
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      bars: [],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    expect(method(result, "book_peer_pb").available).toBe(false);
    expect(method(result, "book_peer_pb").unavailableReason).toBe("Current price is unavailable");
    expect(result.currentPrice).toBeNull();
    expect(result.differenceVsPrice).toBeNull();
  });

  it("calculates REIT only", () => {
    for (const profile of ["GENERAL", "BANK", "OTHER_FINANCIAL", "UNKNOWN"] as const) {
      const result = value({
        profile,
        periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10, eps: 2, dividendPerShare: 0.4 })],
        peers: reitPeers(6),
      });
      expect(result.confidence).toBe("UNAVAILABLE");
      expect(result.fairValueBase).toBeNull();
      expect(result.methods).toEqual([]);
      expect(result.modelVersion).toBe("reit-relative-v1");
      expect(result.unavailableReason).toContain(profile);
      expect(result.unavailableReason).toContain("REIT");
    }
  });

  it("leaves GENERAL and BANK fair value unchanged", () => {
    const general = calculateGeneralFairValue({
      ticker: "ACME",
      researchProfile: "GENERAL",
      industry: "Widgets - Industrial",
      sector: "Industrials",
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: Array.from({ length: 5 }, (_, i) =>
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
      ),
      asOf: AS_OF,
    });
    expect(general.modelVersion).toBe(FAIR_VALUE_MODEL_VERSION);
    expect(general.modelVersion).toBe("general-relative-v1");
    expect(general.fairValueBase).toBe(20);
    expect(general.fairValueLow).toBeNull();
    expect(general.confidence).toBe("LOW");

    const generalOnReit = calculateGeneralFairValue({
      ticker: "ACME",
      researchProfile: "REIT",
      industry: "REIT - Retail",
      sector: "Real Estate",
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10, eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: reitPeers(6),
      asOf: AS_OF,
    });
    expect(generalOnReit.modelVersion).toBe("general-relative-v1");
    expect(generalOnReit.confidence).toBe("UNAVAILABLE");
    expect(generalOnReit.methods).toEqual([]);
    expect(generalOnReit.unavailableReason).toContain("REIT");
    expect(generalOnReit.unavailableReason).toContain("GENERAL");

    const bank = calculateBankFairValue({
      ticker: "ACME",
      researchProfile: "BANK",
      industry: "Banks - Regional",
      sector: "Financial Services",
      periods: [annual({ periodEnd: "2025-12-31", eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: Array.from({ length: 5 }, (_, i) =>
        peer({
          ticker: `B${i + 1}`,
          close: 10,
          eps: 1,
          dividendPerShare: null,
          equity: null,
          shares: null,
          researchProfile: "BANK",
          industry: "Banks - Regional",
        }),
      ),
      asOf: AS_OF,
    });
    expect(bank.modelVersion).toBe(BANK_FAIR_VALUE_MODEL_VERSION);
    expect(bank.modelVersion).toBe("bank-relative-v1");
    expect(bank.fairValueBase).toBe(20);
    expect(bank.confidence).toBe("LOW");

    const bankOnReit = calculateBankFairValue({
      ticker: "ACME",
      researchProfile: "REIT",
      industry: "REIT - Retail",
      sector: "Real Estate",
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10, eps: 2 })],
      bars: [bar("2026-09-25", 11)],
      peers: reitPeers(6),
      asOf: AS_OF,
    });
    expect(bankOnReit.modelVersion).toBe("bank-relative-v1");
    expect(bankOnReit.confidence).toBe("UNAVAILABLE");
    expect(bankOnReit.methods).toEqual([]);
    expect(bankOnReit.unavailableReason).toContain("REIT");
    expect(bankOnReit.unavailableReason).toContain("BANK");
  });

  it("leaves Research Score and Valuation Score unchanged", () => {
    const config = loadScoringConfig();
    function metric(id: string, metricValue: number): MetricValue {
      return {
        id,
        label: id,
        value: metricValue,
        unit: "ratio",
        available: true,
        reason: null,
        period: "2025-12-31",
        inputs: [{ name: id, value: metricValue }],
        formula: id,
      };
    }
    const metrics = [
      metric("dividend_yield", 0.05),
      metric("book_nav_premium", 0.1),
      metric("dpu_cagr", 0.04),
      metric("reit_gearing", 0.35),
      metric("revenue_cagr", 0.05),
    ];
    const before = scoreFromMetrics({
      config,
      instrumentType: "REIT",
      ticker: "ACME",
      researchProfile: "REIT",
      metrics,
      asOf: AS_OF,
    });
    const fair = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    const after = scoreFromMetrics({
      config,
      instrumentType: "REIT",
      ticker: "ACME",
      researchProfile: "REIT",
      metrics,
      asOf: AS_OF,
    });
    expect(after.researchScore).toBe(before.researchScore);
    expect(after.valuationScore).toBe(before.valuationScore);
    expect(after.valuationScore).not.toBe(fair.fairValueBase);
    expect(method(fair, "book_peer_pb").medianMultiple).toBe(2);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(0.4);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(-0.1);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(0.03);
    expect(method(fair, "book_peer_pb").medianMultiple).not.toBe(0.07);

    const scoreSource = readFileSync("src/scoring/score.ts", "utf8");
    const runnerSource = readFileSync("src/scoring/run-ticker.ts", "utf8");
    const pageSource = readFileSync("src/app/stock/[ticker]/page.tsx", "utf8");
    const dailySource = readFileSync("src/refresh/daily.ts", "utf8");
    const generalSource = readFileSync("src/fair-value/calculate.ts", "utf8");
    const bankSource = readFileSync("src/fair-value/calculate-bank.ts", "utf8");
    const reitSource = readFileSync("src/fair-value/calculate-reit.ts", "utf8");
    expect(scoreSource).not.toContain("fair-value");
    expect(runnerSource).not.toContain("fair-value");
    expect(pageSource).not.toContain("calculateReitFairValue");
    expect(dailySource).not.toContain("calculateReitFairValue");
    expect(dailySource).not.toContain("fair-value");
    expect(generalSource).not.toContain("reit-relative");
    expect(bankSource).not.toContain("calculateReitFairValue");
    expect(reitSource).not.toContain("yahoo");
    expect(reitSource).not.toContain("loadScoringConfig");
    expect(reitSource).not.toContain("price_to_earnings");
    expect(reitSource).not.toContain("dividend_yield");
  });

  it("stores a REIT row only through the explicit insert path", () => {
    const sqlite = new Database(":memory:");
    migrateSqliteSchema(sqlite);
    const instrument = sqlite
      .prepare(
        `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
         VALUES ('ACME', 'Acme REIT', 'REIT', '2026-01-01', '2026-01-01')`,
      )
      .run();
    const result = value({
      periods: [annual({ periodEnd: "2025-12-31", equity: 100, shares: 10 })],
      peers: reitPeers(5, { close: 10, equity: 50, shares: 10 }),
    });
    insertFairValueRun(sqlite, {
      instrumentId: Number(instrument.lastInsertRowid),
      result,
      calculatedAt: "2026-09-28T01:00:00.000Z",
    });
    const row = sqlite
      .prepare(`SELECT model_version, research_profile, fair_value_base, assumptions_json FROM fair_value_runs`)
      .get() as {
      model_version: string;
      research_profile: string;
      fair_value_base: number;
      assumptions_json: string;
    };
    expect(row.model_version).toBe("reit-relative-v1");
    expect(row.research_profile).toBe("REIT");
    expect(row.fair_value_base).toBe(20);
    const assumptions = JSON.parse(row.assumptions_json) as { yamlScoreBandsUsed: boolean; excludedApproaches: string };
    expect(assumptions.yamlScoreBandsUsed).toBe(false);
    expect(assumptions.excludedApproaches).toContain("DCF");
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
