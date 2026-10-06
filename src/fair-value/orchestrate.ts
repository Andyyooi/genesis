import * as bankFairValue from "@/fair-value/calculate-bank";
import * as generalFairValue from "@/fair-value/calculate";
import * as reitFairValue from "@/fair-value/calculate-reit";
import type { FairValueAssumptions, FairValueResult } from "@/fair-value/types";

/** Profile has no Fair Value model. Not a fourth valuation method. */
export const UNSUPPORTED_FAIR_VALUE_MODEL_VERSION = "unsupported";

export type FairValueInput = Parameters<typeof generalFairValue.calculateGeneralFairValue>[0];

/**
 * Route Fair Value by the supplied research profile.
 * Does not load data, read YAML, score the name, or persist a run.
 */
export function calculateFairValue(args: FairValueInput): FairValueResult {
  switch (args.researchProfile) {
    case "GENERAL":
      return generalFairValue.calculateGeneralFairValue(args);
    case "BANK":
      return bankFairValue.calculateBankFairValue(args);
    case "REIT":
      return reitFairValue.calculateReitFairValue(args);
    case "OTHER_FINANCIAL":
    case "UNKNOWN":
    default:
      return unsupportedFairValue(args);
  }
}

function unsupportedFairValue(args: FairValueInput): FairValueResult {
  const assumptions: FairValueAssumptions = {
    modelVersion: UNSUPPORTED_FAIR_VALUE_MODEL_VERSION,
    researchProfile: args.researchProfile,
    modelDefaultsUsed: false,
    yamlScoreBandsUsed: false,
    peerGroupType: null,
    peerSelectionPath: null,
    peerEligibleCount: null,
    peerUnavailableReason: null,
    historicalPointCount: 0,
    lookAheadSafe: false,
    historicalValuationStatus: "UNAVAILABLE",
    historicalLimitation: null,
    freshness: "UNKNOWN",
    freshnessObservationDate: null,
    freshnessAgeMonths: null,
    currentPriceDate: null,
    fundamentalsPeriodEnd: null,
  };
  return {
    ticker: args.ticker,
    researchProfile: args.researchProfile,
    modelVersion: UNSUPPORTED_FAIR_VALUE_MODEL_VERSION,
    valuationDate: null,
    fundamentalsPeriodEnd: null,
    currentPrice: null,
    fairValueLow: null,
    fairValueBase: null,
    fairValueHigh: null,
    differenceVsPrice: null,
    confidence: "UNAVAILABLE",
    methods: [],
    assumptions,
    unavailableReason: `No Fair Value model exists for research profile ${args.researchProfile}.`,
  };
}
