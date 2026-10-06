import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as bankFairValue from "@/fair-value/calculate-bank";
import * as generalFairValue from "@/fair-value/calculate";
import * as reitFairValue from "@/fair-value/calculate-reit";
import {
  calculateFairValue,
  UNSUPPORTED_FAIR_VALUE_MODEL_VERSION,
  type FairValueInput,
} from "@/fair-value/orchestrate";
import {
  BANK_FAIR_VALUE_MODEL_VERSION,
  FAIR_VALUE_MODEL_VERSION,
  REIT_FAIR_VALUE_MODEL_VERSION,
} from "@/fair-value/types";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import type { PeerUniverseRow } from "@/scoring/peer-group";

const AS_OF = "2026-09-28T00:00:00.000Z";

const generalSpy = vi.spyOn(generalFairValue, "calculateGeneralFairValue");
const bankSpy = vi.spyOn(bankFairValue, "calculateBankFairValue");
const reitSpy = vi.spyOn(reitFairValue, "calculateReitFairValue");

afterEach(() => {
  generalSpy.mockClear();
  bankSpy.mockClear();
  reitSpy.mockClear();
});

function annual(args: {
  periodEnd: string;
  eps?: number | null;
  equity?: number | null;
  shares?: number | null;
  dividendPerShare?: number | null;
}): StatementSnapshot {
  return {
    periodEnd: args.periodEnd,
    availableAt: null,
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

function bar(barDate: string, close: number): PriceBarSnapshot {
  return { barDate, close, high: null, low: null };
}

function peer(args: {
  ticker: string;
  researchProfile: ResearchProfile;
  industry: string;
  sector: string;
  instrumentType: "COMMON_STOCK" | "REIT";
  close?: number;
  eps?: number | null;
  equity?: number | null;
  shares?: number | null;
  dividendPerShare?: number | null;
}): PeerUniverseRow {
  return {
    ticker: args.ticker,
    name: args.ticker,
    listingStatus: "listed",
    instrumentType: args.instrumentType,
    researchProfile: args.researchProfile,
    industry: args.industry,
    sector: args.sector,
    lastClose: args.close ?? 10,
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

function listedPeers(
  count: number,
  profile: ResearchProfile,
  industry: string,
  sector: string,
  instrumentType: "COMMON_STOCK" | "REIT",
  prefix: string,
): PeerUniverseRow[] {
  return Array.from({ length: count }, (_, i) =>
    peer({
      ticker: `${prefix}${i + 1}`,
      researchProfile: profile,
      industry,
      sector,
      instrumentType,
      close: 10,
      eps: 1,
      equity: 50,
      shares: 10,
      dividendPerShare: null,
    }),
  );
}

function input(profile: ResearchProfile): FairValueInput {
  const industry =
    profile === "BANK" ? "Banks - Regional" : profile === "REIT" ? "REIT - Retail" : "Widgets - Industrial";
  const sector = profile === "BANK" ? "Financial Services" : profile === "REIT" ? "Real Estate" : "Industrials";
  const instrumentType = profile === "REIT" ? "REIT" : "COMMON_STOCK";
  const peerProfile: ResearchProfile = profile === "BANK" || profile === "REIT" ? profile : "GENERAL";
  return {
    ticker: "ACME",
    researchProfile: profile,
    industry,
    sector,
    periods: [annual({ periodEnd: "2025-12-31", eps: 2, equity: 100, shares: 10 })],
    bars: [bar("2026-09-25", 11)],
    peers: listedPeers(5, peerProfile, industry, sector, instrumentType, profile.slice(0, 1)),
    asOf: AS_OF,
  };
}

function expectOnly(called: "GENERAL" | "BANK" | "REIT" | "NONE") {
  expect(generalSpy).toHaveBeenCalledTimes(called === "GENERAL" ? 1 : 0);
  expect(bankSpy).toHaveBeenCalledTimes(called === "BANK" ? 1 : 0);
  expect(reitSpy).toHaveBeenCalledTimes(called === "REIT" ? 1 : 0);
}

describe("Fair Value orchestration", () => {
  it("returns the GENERAL calculator result unchanged", () => {
    const args = input("GENERAL");
    const direct = generalFairValue.calculateGeneralFairValue(args);
    generalSpy.mockClear();
    const routed = calculateFairValue(args);
    expect(routed).toEqual(direct);
    expect(routed).toBe(generalSpy.mock.results[0]?.value);
    expect(routed.modelVersion).toBe(FAIR_VALUE_MODEL_VERSION);
    expect(routed.modelVersion).toBe("general-relative-v1");
    expect(routed.fairValueBase).toBe(20);
    expect(routed.assumptions.modelDefaultsUsed).toBe(false);
    expect(routed.assumptions.yamlScoreBandsUsed).toBe(false);
    expectOnly("GENERAL");
  });

  it("returns the BANK calculator result unchanged", () => {
    const args = input("BANK");
    const direct = bankFairValue.calculateBankFairValue(args);
    bankSpy.mockClear();
    const routed = calculateFairValue(args);
    expect(routed).toEqual(direct);
    expect(routed).toBe(bankSpy.mock.results[0]?.value);
    expect(routed.modelVersion).toBe(BANK_FAIR_VALUE_MODEL_VERSION);
    expect(routed.modelVersion).toBe("bank-relative-v1");
    expect(routed.researchProfile).toBe("BANK");
    expect(routed.assumptions.modelDefaultsUsed).toBe(false);
    expect(routed.assumptions.yamlScoreBandsUsed).toBe(false);
    expectOnly("BANK");
  });

  it("returns the REIT calculator result unchanged", () => {
    const args = input("REIT");
    const direct = reitFairValue.calculateReitFairValue(args);
    reitSpy.mockClear();
    const routed = calculateFairValue(args);
    expect(routed).toEqual(direct);
    expect(routed).toBe(reitSpy.mock.results[0]?.value);
    expect(routed.modelVersion).toBe(REIT_FAIR_VALUE_MODEL_VERSION);
    expect(routed.modelVersion).toBe("reit-relative-v1");
    expect(routed.researchProfile).toBe("REIT");
    expect(routed.fairValueBase).toBe(20);
    expect(routed.assumptions.modelDefaultsUsed).toBe(false);
    expect(routed.assumptions.yamlScoreBandsUsed).toBe(false);
    expectOnly("REIT");
  });

  it("returns unavailable for OTHER_FINANCIAL without calling a calculator", () => {
    const productive = input("GENERAL");
    const direct = generalFairValue.calculateGeneralFairValue(productive);
    expect(direct.fairValueBase).toBe(20);
    expect(direct.modelVersion).toBe("general-relative-v1");
    generalSpy.mockClear();

    const args = { ...productive, researchProfile: "OTHER_FINANCIAL" as const };
    const routed = calculateFairValue(args);
    expect(routed.modelVersion).toBe("unsupported");
    expect(routed.modelVersion).toBe(UNSUPPORTED_FAIR_VALUE_MODEL_VERSION);
    expect(routed.confidence).toBe("UNAVAILABLE");
    expect(routed.methods).toEqual([]);
    expect(routed.fairValueLow).toBeNull();
    expect(routed.fairValueBase).toBeNull();
    expect(routed.fairValueHigh).toBeNull();
    expect(routed.differenceVsPrice).toBeNull();
    expect(routed.researchProfile).toBe("OTHER_FINANCIAL");
    expect(routed.unavailableReason).toContain("OTHER_FINANCIAL");
    expect(routed.assumptions.modelDefaultsUsed).toBe(false);
    expect(routed.assumptions.yamlScoreBandsUsed).toBe(false);
    expect(routed.assumptions.modelVersion).toBe("unsupported");
    expectOnly("NONE");
  });

  it("returns unavailable for UNKNOWN and any other unsupported profile", () => {
    const productive = input("GENERAL");
    generalSpy.mockClear();
    const unknown = calculateFairValue({ ...productive, researchProfile: "UNKNOWN" });
    expect(unknown.modelVersion).toBe("unsupported");
    expect(unknown.confidence).toBe("UNAVAILABLE");
    expect(unknown.methods).toEqual([]);
    expect(unknown.fairValueBase).toBeNull();
    expect(unknown.fairValueLow).toBeNull();
    expect(unknown.fairValueHigh).toBeNull();
    expect(unknown.differenceVsPrice).toBeNull();
    expect(unknown.unavailableReason).toContain("UNKNOWN");
    expect(unknown.assumptions.modelDefaultsUsed).toBe(false);
    expect(unknown.assumptions.yamlScoreBandsUsed).toBe(false);
    expectOnly("NONE");

    const other = calculateFairValue({
      ...productive,
      researchProfile: "NOT_A_PROFILE" as ResearchProfile,
    });
    expect(other.modelVersion).toBe("unsupported");
    expect(other.confidence).toBe("UNAVAILABLE");
    expect(other.methods).toEqual([]);
    expect(other.fairValueBase).toBeNull();
    expect(other.unavailableReason).toContain("NOT_A_PROFILE");
    expectOnly("NONE");
  });

  it("does not mutate calculator inputs", () => {
    const args = input("GENERAL");
    const before = structuredClone(args);
    calculateFairValue(args);
    expect(args).toEqual(before);

    const unsupported = { ...input("GENERAL"), researchProfile: "OTHER_FINANCIAL" as const };
    const unsupportedBefore = structuredClone(unsupported);
    calculateFairValue(unsupported);
    expect(unsupported).toEqual(unsupportedBefore);
  });

  it("stays free of persistence, scoring, refresh, and UI imports", () => {
    const source = readFileSync("src/fair-value/orchestrate.ts", "utf8");
    expect(source).not.toMatch(
      /@\/scoring|@\/refresh|@\/app|@\/db|from "@\/fair-value\/persist"|getDb|getSqlite|loadScoringConfig|scoreTicker|scoring\.yaml/,
    );
  });
});
