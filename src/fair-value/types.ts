import type { ResearchProfile } from "@/research/profiles";
import type { FreshnessBand } from "@/scoring/freshness";
import type { PeerGroupType } from "@/scoring/peer-group";
import type { HistoricalValuationStatus } from "@/db/point-in-time";

/** Relative GENERAL methods only. No macro default, no DCF, no score weights. */
export const FAIR_VALUE_MODEL_VERSION = "general-relative-v1";

/** Relative BANK methods only. No required return, no industrial cash-flow adjustment. */
export const BANK_FAIR_VALUE_MODEL_VERSION = "bank-relative-v1";

/** Relative REIT accounting-book methods only. No reported NAV, DPU, or property DCF. */
export const REIT_FAIR_VALUE_MODEL_VERSION = "reit-relative-v1";

export const FAIR_VALUE_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW", "UNAVAILABLE"] as const;
export type FairValueConfidence = (typeof FAIR_VALUE_CONFIDENCE_LEVELS)[number];

export const FAIR_VALUE_METHOD_IDS = [
  "earnings_peer_pe",
  "earnings_history_pe",
  "book_peer_pb",
  "book_history_pb",
  "dividend_peer_yield",
  "dividend_history_yield",
] as const;
export type FairValueMethodId = (typeof FAIR_VALUE_METHOD_IDS)[number];

export type FairValueMethodKind = "peer" | "history";

export type FairValueMethodEvidence = {
  id: FairValueMethodId;
  label: string;
  kind: FairValueMethodKind;
  available: boolean;
  methodValue: number | null;
  formula: string;
  /** EPS, book value per share, or DPS used as the current input. */
  currentInput: number | null;
  currentInputName: "eps" | "book_value_per_share" | "dividend_per_share" | null;
  medianMultiple: number | null;
  medianName: string | null;
  sampleSize: number | null;
  peerGroup: string | null;
  peerCount: number | null;
  historicalSampleCount: number | null;
  fundamentalsPeriodEnd: string | null;
  valuationDate: string | null;
  /** Price dates of historical points that entered the median. */
  priceDates: string[] | null;
  historicalPeriodEnds: string[] | null;
  lookAheadSafe: boolean | null;
  unavailableReason: string | null;
};

export type FairValueAssumptions = {
  modelVersion: string;
  researchProfile: ResearchProfile;
  /** This model does not apply a discount rate, terminal growth, or YAML score band. */
  modelDefaultsUsed: false;
  yamlScoreBandsUsed: false;
  peerGroupType: PeerGroupType | null;
  peerSelectionPath: string | null;
  peerEligibleCount: number | null;
  peerUnavailableReason: string | null;
  historicalPointCount: number;
  lookAheadSafe: boolean;
  historicalValuationStatus: HistoricalValuationStatus;
  historicalLimitation: string | null;
  freshness: FreshnessBand;
  freshnessObservationDate: string | null;
  freshnessAgeMonths: number | null;
  currentPriceDate: string | null;
  fundamentalsPeriodEnd: string | null;
  /**
   * Set by the REIT model. Approaches this version does not calculate.
   * GENERAL and BANK results omit this field.
   */
  excludedApproaches?: string;
};

export type FairValueResult = {
  ticker: string;
  researchProfile: ResearchProfile;
  modelVersion: string;
  valuationDate: string | null;
  fundamentalsPeriodEnd: string | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueBase: number | null;
  fairValueHigh: number | null;
  /** (fair_value_base − current_price) / current_price. Not a recommendation. */
  differenceVsPrice: number | null;
  confidence: FairValueConfidence;
  methods: FairValueMethodEvidence[];
  assumptions: FairValueAssumptions;
  unavailableReason: string | null;
};
