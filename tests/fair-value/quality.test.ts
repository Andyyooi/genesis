import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessFairValueQuality,
  type FairValueQualityAnnual,
} from "@/fair-value/quality";
import type { FairValueAssumptions, FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";

const PERIOD_END_LIMITATION =
  "Period-end price vs that period’s earnings, filing date unknown. This is not look-ahead-safe point-in-time P/E.";

function annual(
  periodEnd: string,
  eps: number | null,
  pat: number | null,
  shares: number | null,
  dividendPerShare: number | null = null,
): FairValueQualityAnnual {
  return { periodEnd, eps, pat, shares, dividendPerShare };
}

function assumptions(patch: Partial<FairValueAssumptions> = {}): FairValueAssumptions {
  return {
    modelVersion: "general-relative-v1",
    researchProfile: "GENERAL",
    modelDefaultsUsed: false,
    yamlScoreBandsUsed: false,
    peerGroupType: "INDUSTRY",
    peerSelectionPath: "Widgets",
    peerEligibleCount: 12,
    peerUnavailableReason: null,
    historicalPointCount: 2,
    lookAheadSafe: false,
    historicalValuationStatus: "PERIOD_END_ONLY",
    historicalLimitation: PERIOD_END_LIMITATION,
    freshness: "FRESH",
    freshnessObservationDate: "2025-12-31",
    freshnessAgeMonths: 9,
    currentPriceDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    ...patch,
  };
}

function method(
  patch: Partial<FairValueMethodEvidence> & Pick<FairValueMethodEvidence, "id" | "label">,
): FairValueMethodEvidence {
  return {
    kind: "peer",
    available: true,
    methodValue: 1,
    formula: "fixture",
    currentInput: 1,
    currentInputName: "eps",
    medianMultiple: 1,
    medianName: null,
    sampleSize: 8,
    peerGroup: null,
    peerCount: 8,
    historicalSampleCount: null,
    fundamentalsPeriodEnd: "2025-12-31",
    valuationDate: "2026-09-25",
    priceDates: null,
    historicalPeriodEnds: null,
    lookAheadSafe: false,
    unavailableReason: null,
    ...patch,
  };
}

function absentEarnings(id: "earnings_peer_pe" | "earnings_history_pe", reason: string): FairValueMethodEvidence {
  return method({
    id,
    label: id,
    available: false,
    methodValue: null,
    currentInput: null,
    currentInputName: "eps",
    medianMultiple: null,
    unavailableReason: reason,
  });
}

function result(patch: Partial<FairValueResult> & Pick<FairValueResult, "methods">): FairValueResult {
  const base = patch.fairValueBase ?? null;
  const price = patch.currentPrice ?? null;
  return {
    ticker: "FIXTURE",
    researchProfile: "GENERAL",
    modelVersion: "general-relative-v1",
    valuationDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    currentPrice: price,
    fairValueLow: patch.fairValueLow ?? null,
    fairValueBase: base,
    fairValueHigh: patch.fairValueHigh ?? null,
    differenceVsPrice: price != null && price > 0 && base != null ? (base - price) / price : null,
    confidence: "HIGH",
    assumptions: assumptions(),
    unavailableReason: null,
    ...patch,
  };
}

function codes(rows: { code: string }[]): string[] {
  return rows.map((row) => row.code);
}

describe("assessFairValueQuality", () => {
  it("keeps a clean EPS inside 10% at CLEAR / POINT_OK", () => {
    const built = result({
      currentPrice: 12,
      fairValueLow: 10,
      fairValueBase: 10.5,
      fairValueHigh: 11,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings × peer median P/E", methodValue: 10, currentInput: 1.02 }),
        method({
          id: "book_peer_pb",
          label: "Book value × peer median P/B",
          methodValue: 11,
          currentInputName: "book_value_per_share",
          currentInput: 8,
        }),
        method({
          id: "dividend_peer_yield",
          label: "DPS ÷ peer median dividend yield",
          methodValue: 10.5,
          currentInputName: "dividend_per_share",
          currentInput: 0.2,
        }),
      ],
    });
    const annuals = [
      annual("2024-12-31", 1, 100, 100, 0.2),
      annual("2025-12-31", 1.02, 102, 100, 0.2),
    ];
    const before = JSON.stringify({ built, annuals });
    const quality = assessFairValueQuality(built, annuals);
    expect(JSON.stringify({ built, annuals })).toBe(before);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(quality.methods.every((row) => row.state === "CLEAR" && row.flags.length === 0)).toBe(true);
    expect(quality.notes).toEqual([]);
    expect(built.confidence).toBe("HIGH");
  });

  it("flags a 100× EPS scale break and keeps a clean median as caution", () => {
    const shares = 209_769_201;
    const built = result({
      ticker: "UMCCA",
      currentPrice: 5.95,
      fairValueLow: 5.2137,
      fairValueBase: 7.0632,
      fairValueHigh: 623.03,
      methods: [
        method({
          id: "earnings_peer_pe",
          label: "Earnings × peer median P/E",
          methodValue: 623.03,
          currentInput: 68.97,
        }),
        method({
          id: "book_peer_pb",
          label: "Book value × peer median P/B",
          methodValue: 5.2137,
          currentInputName: "book_value_per_share",
          currentInput: 7.44,
        }),
        method({
          id: "dividend_peer_yield",
          label: "DPS ÷ peer median dividend yield",
          methodValue: 7.0632,
          currentInputName: "dividend_per_share",
          currentInput: 0.13,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-04-30", 0.2405, 50_663_000, shares),
      annual("2026-04-30", 68.97, 144_678_000, shares, 0.13),
    ]);
    const earnings = quality.methods.find((row) => row.id === "earnings_peer_pe");
    const book = quality.methods.find((row) => row.id === "book_peer_pb");
    const dividend = quality.methods.find((row) => row.id === "dividend_peer_yield");
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITH_CAUTION");
    expect(codes(earnings?.flags ?? [])).toEqual([
      "EPS_SCALE_BREAK_VS_OWN_HISTORY",
      "EPS_YOY_DISCONTINUITY",
    ]);
    expect(book?.state).toBe("CLEAR");
    expect(book?.flags).toEqual([]);
    expect(dividend?.state).toBe("CLEAR");
    expect(dividend?.flags).toEqual([]);
    expect(built.fairValueBase).toBe(7.0632);
    expect(built.confidence).toBe("HIGH");
  });

  it("flags a 314× EPS gap with no older EPS as unresolved", () => {
    const built = result({
      ticker: "FAMIERA",
      currentPrice: 0.23,
      fairValueLow: 0.1456,
      fairValueBase: 0.2717,
      fairValueHigh: 51.6709,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 51.6709, currentInput: 5.72 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 0.1456,
          currentInputName: "book_value_per_share",
        }),
        method({
          id: "dividend_peer_yield",
          label: "Dividend",
          methodValue: 0.2717,
          currentInputName: "dividend_per_share",
          currentInput: 0.005,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", null, 7_002_000, 450_000_000),
      annual("2025-12-31", 5.72, 8_196_000, 450_000_000, 0.005),
    ]);
    const earnings = quality.methods.find((row) => row.id === "earnings_peer_pe");
    expect(codes(earnings?.flags ?? [])).toEqual(["EPS_VS_PAT_SHARES_UNRESOLVED"]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITH_CAUTION");
  });

  it("withholds a two-method midpoint when earnings is flagged and book is clear", () => {
    const earningsValue = 8.46;
    const bookValue = 0.08586;
    const built = result({
      ticker: "ENPRO",
      currentPrice: 0.325,
      fairValueLow: bookValue,
      fairValueBase: (earningsValue + bookValue) / 2,
      fairValueHigh: earningsValue,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: earningsValue, currentInput: 0.54 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: bookValue,
          currentInputName: "book_value_per_share",
          currentInput: 0.107,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2023-12-31", 0.01162, 12_201_000, 1_050_000_000),
      annual("2024-12-31", 0, 20_218_000, 1_050_000_000),
      annual("2025-12-31", 0.54, 5_096_806, 1_050_000_000),
    ]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITHHELD");
    expect(codes(quality.methods[0]?.flags ?? [])).toContain("EPS_SCALE_BREAK_VS_OWN_HISTORY");
    expect(quality.methods[1]?.state).toBe("CLEAR");
    expect(quality.methods[1]?.flags).toEqual([]);
    expect(built.fairValueBase).toBeCloseTo(4.27293, 4);
  });

  it("flags a calculated earnings method when EPS and PAT have opposite signs", () => {
    const built = result({
      currentPrice: 1,
      fairValueLow: 2,
      fairValueBase: 2,
      fairValueHigh: 4,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 4, currentInput: 0.29 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 2,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 0.29, -48_098_000, 558_939_211)]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITH_CAUTION");
    expect(codes(quality.methods[0]?.flags ?? [])).toEqual(["EPS_PAT_SIGN_CONFLICT"]);
    expect(quality.methods[1]?.state).toBe("CLEAR");
  });

  it("notes a negative-EPS sign conflict without flagging a clean book method", () => {
    const built = result({
      currentPrice: 20,
      fairValueBase: 18,
      confidence: "LOW",
      methods: [
        absentEarnings("earnings_peer_pe", "EPS is zero or negative — P/E method is unavailable"),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 18,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-09-30", -0.51, 817_278_000, 1_116_200_906)]);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(quality.methods[0]?.state).toBe("ABSENT");
    expect(quality.methods[0]?.flags).toEqual([]);
    expect(codes(quality.methods[0]?.notes ?? [])).toEqual(["EPS_PAT_SIGN_CONFLICT"]);
    expect(quality.methods[1]?.state).toBe("CLEAR");
    expect(built.methods[0]?.methodValue).toBeNull();
  });

  it("notes a sticky zero EPS and does not substitute PAT / shares", () => {
    const built = result({
      currentPrice: 0.8,
      fairValueBase: 0.7,
      confidence: "LOW",
      methods: [
        absentEarnings("earnings_peer_pe", "EPS is zero or negative — P/E method is unavailable"),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 0.7,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 0, 96_060_000, 5_000_000_000)]);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(quality.methods[0]?.state).toBe("ABSENT");
    expect(codes(quality.methods[0]?.notes ?? [])).toEqual(["EPS_EXPLICIT_ZERO_PAT_POSITIVE"]);
    expect(built.methods[0]?.methodValue).toBeNull();
    expect(built.methods[0]?.currentInput).toBeNull();
  });

  it("withholds the point when the only calculated method is flagged", () => {
    const built = result({
      currentPrice: 0.23,
      fairValueBase: 51.67,
      confidence: "LOW",
      methods: [method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 51.67, currentInput: 5.72 })],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 5.72, 8_196_000, 450_000_000)]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITHHELD");
    expect(codes(quality.methods[0]?.flags ?? [])).toEqual(["EPS_VS_PAT_SHARES_UNRESOLVED"]);
  });

  it("withholds the point when every calculated method is flagged", () => {
    const built = result({
      currentPrice: 0.23,
      fairValueLow: 40,
      fairValueBase: 51.67,
      fairValueHigh: 60,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings peer", methodValue: 51.67, currentInput: 5.72 }),
        method({
          id: "earnings_history_pe",
          label: "Earnings history",
          kind: "history",
          methodValue: 60,
          currentInput: 5.72,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 5.72, 8_196_000, 450_000_000)]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITHHELD");
    expect(quality.methods.every((row) => row.state === "FLAGGED")).toBe(true);
  });

  it("leaves a clean wide range as CLEAR / POINT_OK with a spread note", () => {
    const shares = 234_500_000;
    const eps = 2.56;
    const built = result({
      ticker: "NESTLE",
      currentPrice: 90.2,
      fairValueLow: 2.6255,
      fairValueBase: 56,
      fairValueHigh: 124.62,
      confidence: "HIGH",
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings peer", methodValue: 37.8815, currentInput: eps }),
        method({
          id: "earnings_history_pe",
          label: "Earnings history",
          kind: "history",
          methodValue: 124.62,
          currentInput: eps,
        }),
        method({
          id: "book_peer_pb",
          label: "Book peer",
          methodValue: 2.6255,
          currentInputName: "book_value_per_share",
        }),
        method({
          id: "book_history_pb",
          label: "Book history",
          kind: "history",
          methodValue: 109.64,
          currentInputName: "book_value_per_share",
        }),
        method({
          id: "dividend_peer_yield",
          label: "Dividend",
          methodValue: 56,
          currentInputName: "dividend_per_share",
          currentInput: 0.8,
        }),
      ],
    });
    const before = structuredClone(built);
    const quality = assessFairValueQuality(built, [annual("2025-12-31", eps, eps * shares, shares, 0.8)]);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(codes(quality.notes)).toEqual(["SPREAD_AT_LEAST_10X"]);
    expect(quality.notes[0]?.text).toContain("differ");
    expect(quality.notes[0]?.text.toLowerCase()).not.toContain("invalid");
    expect(quality.methods.every((row) => row.flags.length === 0)).toBe(true);
    expect(codes(quality.methods.find((row) => row.id === "book_peer_pb")?.notes ?? [])).toContain(
      "EXTRAORDINARY_VERSUS_PRICE",
    );
    expect(built.confidence).toBe(before.confidence);
    expect(built.fairValueBase).toBe(before.fairValueBase);
    expect(built.methods.map((row) => row.methodValue)).toEqual(before.methods.map((row) => row.methodValue));
  });

  it("notes extraordinary CAPITALA-style inputs without an EPS flag", () => {
    const built = result({
      ticker: "CAPITALA",
      currentPrice: 0.245,
      fairValueLow: 0.1658,
      fairValueBase: 22.3557,
      fairValueHigh: 66,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 22.3557, currentInput: 1.43 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 0.1658,
          currentInputName: "book_value_per_share",
        }),
        method({
          id: "dividend_peer_yield",
          label: "Dividend",
          methodValue: 66,
          currentInputName: "dividend_per_share",
          currentInput: 0.9,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2025-12-31", 1.43, 13_033_555_000, 4_430_195_599, 0.9),
    ]);
    const earnings = quality.methods.find((row) => row.id === "earnings_peer_pe");
    const dividend = quality.methods.find((row) => row.id === "dividend_peer_yield");
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(earnings?.flags).toEqual([]);
    expect(codes(earnings?.notes ?? [])).toEqual(["EPS_GAP_NOTE", "EXTRAORDINARY_VERSUS_PRICE"]);
    expect(codes(dividend?.notes ?? [])).toEqual([
      "EXTRAORDINARY_VERSUS_PRICE",
      "EXTRAORDINARY_DIVIDEND_YIELD",
    ]);
    expect(codes(quality.notes)).toEqual(["SPREAD_AT_LEAST_10X"]);
    expect(built.confidence).toBe("HIGH");
  });

  it("does not flag a MAYBANK-shaped bank result", () => {
    const shares = 12_081_105_315;
    const eps = 0.8705;
    const built = result({
      ticker: "MAYBANK",
      researchProfile: "BANK",
      modelVersion: "bank-relative-v1",
      currentPrice: 10.22,
      fairValueLow: 7.4822,
      fairValueBase: 8.76,
      fairValueHigh: 10.48,
      assumptions: assumptions({ modelVersion: "bank-relative-v1", researchProfile: "BANK" }),
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings peer", methodValue: 8.76, currentInput: eps }),
        method({
          id: "earnings_history_pe",
          label: "Earnings history",
          kind: "history",
          methodValue: 10.48,
          currentInput: eps,
        }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 7.4822,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", eps, eps * shares, shares)]);
    expect(built.modelVersion).toBe("bank-relative-v1");
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(quality.methods.every((row) => row.flags.length === 0 && row.notes.length === 0)).toBe(true);
    expect(quality.notes).toEqual([]);
  });

  it("does not apply EPS rules to REIT book methods and keeps the period-end limitation", () => {
    const exclusions =
      "P/E, distribution yield, DPU, reported NAV, FFO, AFFO, DCF, cap rates, and property-level valuation are not calculated.";
    const built = result({
      ticker: "ALAQAR",
      researchProfile: "REIT",
      modelVersion: "reit-relative-v1",
      currentPrice: 1.15,
      fairValueLow: 1,
      fairValueBase: 1.75,
      fairValueHigh: 2.5,
      assumptions: assumptions({
        modelVersion: "reit-relative-v1",
        researchProfile: "REIT",
        historicalLimitation: PERIOD_END_LIMITATION,
        excludedApproaches: exclusions,
      }),
      methods: [
        method({
          id: "book_peer_pb",
          label: "Accounting book × peer median P/B",
          methodValue: 1,
          currentInputName: "book_value_per_share",
          currentInput: 1.25,
        }),
        method({
          id: "book_history_pb",
          label: "Accounting book × own historical median P/B",
          kind: "history",
          methodValue: 2.5,
          currentInputName: "book_value_per_share",
          currentInput: 1.25,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", 0.07, 5_000_000, 100_000_000),
      annual("2025-12-31", 7, 5_200_000, 100_000_000),
    ]);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(quality.methods.map((row) => row.id)).toEqual(["book_peer_pb", "book_history_pb"]);
    expect(quality.methods.every((row) => row.state === "CLEAR" && row.flags.length === 0)).toBe(true);
    expect(codes(quality.notes)).toEqual(["SPREAD_AT_LEAST_2X"]);
    expect(quality.historicalLimitation).toBe(PERIOD_END_LIMITATION);
    expect(built.assumptions.excludedApproaches).toBe(exclusions);
    expect(JSON.stringify(quality.methods)).not.toContain("reported NAV");
  });

  it("returns NO_VALUE / NO_POINT for an unsupported profile and adds no methods", () => {
    const built = result({
      ticker: "5108",
      researchProfile: "OTHER_FINANCIAL",
      modelVersion: "unsupported",
      currentPrice: null,
      fairValueBase: null,
      confidence: "UNAVAILABLE",
      unavailableReason: "No Fair Value model exists for research profile OTHER_FINANCIAL.",
      assumptions: assumptions({
        modelVersion: "unsupported",
        researchProfile: "OTHER_FINANCIAL",
        historicalLimitation: null,
        historicalValuationStatus: "UNAVAILABLE",
      }),
      methods: [],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 1.43, 100, 50)]);
    expect(quality.status).toBe("NO_VALUE");
    expect(quality.baseUse).toBe("NO_POINT");
    expect(quality.methods).toEqual([]);
    expect(built.methods).toEqual([]);
    expect(built.modelVersion).toBe("unsupported");
    expect(built.confidence).toBe("UNAVAILABLE");
  });

  it("does not change the input result confidence", () => {
    const built = result({
      confidence: "MEDIUM",
      currentPrice: 2,
      fairValueBase: 2,
      methods: [
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 2,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const snapshot = structuredClone(built);
    assessFairValueQuality(built, [annual("2025-12-31", 5.72, 8_196_000, 450_000_000)]);
    expect(built).toEqual(snapshot);
    expect(built.confidence).toBe("MEDIUM");
  });

  it("notes a 10–25% EPS gap without flagging", () => {
    const built = result({
      currentPrice: 8,
      fairValueLow: 7,
      fairValueBase: 7.5,
      fairValueHigh: 8,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 8, currentInput: 1.15 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 7,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 1.15, 100, 100)]);
    const earnings = quality.methods[0];
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(earnings?.state).toBe("CLEAR");
    expect(earnings?.flags).toEqual([]);
    expect(codes(earnings?.notes ?? [])).toEqual(["EPS_GAP_NOTE"]);
  });

  it("does not treat a year-over-year EPS reversal as a discontinuity when latest EPS matches PAT / shares", () => {
    const priorShares = 725_484_731;
    const latestShares = 721_525_097;
    const built = result({
      ticker: "HUMEIND",
      currentPrice: 2.65,
      fairValueLow: 1.0143,
      fairValueBase: 4.0345,
      fairValueHigh: 7.0548,
      confidence: "MEDIUM",
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 7.0548, currentInput: 0.6 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1.0143,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2025-06-30", 30.84, 223_171_000, priorShares),
      annual("2026-06-30", 0.6, 430_559_000, latestShares),
    ]);
    const earnings = quality.methods.find((row) => row.id === "earnings_peer_pe");
    expect(codes(earnings?.flags ?? [])).not.toContain("EPS_YOY_DISCONTINUITY");
    expect(earnings?.flags).toEqual([]);
    expect(earnings?.state).toBe("CLEAR");
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
    expect(codes(quality.notes)).toEqual(["SPREAD_AT_LEAST_2X"]);
  });

  it("keeps a year-over-year discontinuity when latest EPS is outside 10% of PAT / shares", () => {
    const built = result({
      currentPrice: 2,
      fairValueBase: 40,
      methods: [method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 40, currentInput: 5 })],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", 0.2, 20, 100),
      annual("2025-12-31", 5, 25, 100),
    ]);
    expect(codes(quality.methods[0]?.flags ?? [])).toEqual([
      "EPS_VS_PAT_SHARES_UNRESOLVED",
      "EPS_YOY_DISCONTINUITY",
    ]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITHHELD");
  });

  it("keeps PWRWELL unresolved and year-over-year flags when latest EPS stays inconsistent", () => {
    const shares = 580_552_000;
    const built = result({
      ticker: "PWRWELL",
      currentPrice: 1.2,
      fairValueLow: 0.1565,
      fairValueBase: 27.3354,
      fairValueHigh: 54.5143,
      confidence: "MEDIUM",
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 54.5143, currentInput: 2.65 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 0.1565,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2025-03-31", 0.0323, 19_035_000, shares),
      annual("2026-03-31", 2.65, 24_065_000, shares),
    ]);
    expect(codes(quality.methods[0]?.flags ?? [])).toEqual([
      "EPS_VS_PAT_SHARES_UNRESOLVED",
      "EPS_YOY_DISCONTINUITY",
    ]);
    expect(quality.status).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITHHELD");
  });

  it("keeps TECHSTORE scale-break and year-over-year flags when latest EPS stays inconsistent", () => {
    const shares = 500_000_000;
    const built = result({
      ticker: "TECHSTORE",
      currentPrice: 0.175,
      fairValueLow: 0.1979,
      fairValueBase: 0.2188,
      fairValueHigh: 32.9875,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 32.9875, currentInput: 2.03 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 0.2188,
          currentInputName: "book_value_per_share",
        }),
        method({
          id: "dividend_peer_yield",
          label: "Dividend",
          methodValue: 0.1979,
          currentInputName: "dividend_per_share",
          currentInput: 0.01,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", 0.012576, 6_336_000, shares),
      annual("2025-12-31", 2.03, 9_853_000, shares),
    ]);
    const earnings = quality.methods.find((row) => row.id === "earnings_peer_pe");
    expect(codes(earnings?.flags ?? [])).toEqual([
      "EPS_SCALE_BREAK_VS_OWN_HISTORY",
      "EPS_YOY_DISCONTINUITY",
    ]);
    expect(quality.baseUse).toBe("POINT_WITH_CAUTION");
  });

  it("does not treat a near-zero EPS jump as a year-over-year discontinuity", () => {
    const built = result({
      currentPrice: 2,
      fairValueBase: 1.5,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 1.2, currentInput: 0.05 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1.5,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", 0.001, 10, 100),
      annual("2025-12-31", 0.05, 10, 100),
    ]);
    expect(codes(quality.methods[0]?.flags ?? [])).not.toContain("EPS_YOY_DISCONTINUITY");
    expect(quality.methods[0]?.flags).toEqual([]);
    expect(codes(quality.methods[0]?.notes ?? [])).toEqual(["EPS_GAP_NOTE"]);
    expect(quality.status).toBe("CLEAR");
  });

  it("does not flag a year-over-year EPS jump when PAT moves by a similar factor", () => {
    const built = result({
      currentPrice: 6,
      fairValueBase: 5,
      methods: [method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 5, currentInput: 5 })],
    });
    const quality = assessFairValueQuality(built, [
      annual("2024-12-31", 0.2, 20, 100),
      annual("2025-12-31", 5, 500, 100),
    ]);
    expect(quality.methods[0]?.flags).toEqual([]);
    expect(quality.methods[0]?.notes).toEqual([]);
    expect(quality.status).toBe("CLEAR");
    expect(quality.baseUse).toBe("POINT_OK");
  });

  it("treats a base that matches the clean-method median as caution", () => {
    const built = result({
      currentPrice: 2,
      fairValueLow: 1,
      fairValueBase: 3,
      fairValueHigh: 5,
      methods: [
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1,
          currentInputName: "book_value_per_share",
        }),
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 3, currentInput: 5.72 }),
        method({
          id: "dividend_peer_yield",
          label: "Dividend",
          methodValue: 5,
          currentInputName: "dividend_per_share",
          currentInput: 0.05,
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [annual("2025-12-31", 5.72, 8_196_000, 450_000_000, 0.05)]);
    expect(quality.methods.find((row) => row.id === "earnings_peer_pe")?.state).toBe("FLAGGED");
    expect(quality.baseUse).toBe("POINT_WITH_CAUTION");
  });

  it("flags an 11× EPS gap with matched history as unresolved rather than a 100× scale break", () => {
    const shares = 3_647_566_120;
    const built = result({
      currentPrice: 3.03,
      fairValueBase: 1.65,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 0.108, currentInput: 0.01 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1.65,
          currentInputName: "book_value_per_share",
        }),
      ],
    });
    const quality = assessFairValueQuality(built, [
      annual("2025-03-31", 0.089, 0.089 * shares, shares),
      annual("2026-03-31", 0.01, 3_249_000, shares),
    ]);
    expect(codes(quality.methods[0]?.flags ?? [])).toEqual(["EPS_VS_PAT_SHARES_UNRESOLVED"]);
  });

  it("stays free of calculators, storage, and network imports", () => {
    const source = readFileSync(new URL("../../src/fair-value/quality.ts", import.meta.url), "utf8");
    expect(source).not.toContain("better-sqlite3");
    expect(source).not.toContain("calculateFairValue");
    expect(source).not.toContain("calculateGeneralFairValue");
    expect(source).not.toContain("calculateBankFairValue");
    expect(source).not.toContain("calculateReitFairValue");
    expect(source).not.toContain("persistFairValueRun");
    expect(source).not.toContain("scoreTicker");
    expect(source).not.toContain("yahoo");
    expect(source).not.toContain("UNAVAILABLE");
  });
});
