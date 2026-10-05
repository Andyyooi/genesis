import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import type { HistoricalValuationStatus } from "@/db/point-in-time";
import { historicalValuationStatus } from "@/db/point-in-time";
import { assessObservationFreshness, type FreshnessBand } from "@/scoring/freshness";
import { MIN_USABLE_PEERS, selectPeerSet, type PeerUniverseRow } from "@/scoring/peer-group";
import {
  buildHistoricalPoints,
  median,
  metricFromInputs,
  MIN_HISTORICAL_POINTS,
  PERIOD_END_LIMITATION,
  type HistoricalPoint,
} from "@/scoring/valuation-context";
import {
  REIT_FAIR_VALUE_MODEL_VERSION,
  type FairValueAssumptions,
  type FairValueConfidence,
  type FairValueMethodEvidence,
  type FairValueMethodId,
  type FairValueMethodKind,
  type FairValueResult,
} from "@/fair-value/types";

const FILING_ALIGNED_LIMITATION =
  "Historical series uses price on or before each filing’s available_at with that period’s line items.";

/** P/B only. Distribution yield does not qualify a REIT peer set. */
const REIT_VOTE_METRICS = ["price_to_book"] as const;

const EXCLUDED_APPROACHES =
  "P/E, distribution yield, DPU, reported NAV, FFO, AFFO, DCF, cap rates, and property-level valuation are not calculated. Equity / shares is accounting book value per share, not reported NAV. dividendPerShare is not used as DPU. Debt, cash, operating cash flow, and capex are not inputs.";

type CurrentFundamentals = {
  periodEnd: string | null;
  availableAt: string | null;
  equity: number | null;
  shares: number | null;
  bookValuePerShare: number | null;
  bookUnavailableReason: string | null;
};

type MultipleSample = {
  values: number[];
  priceDates: string[];
  periodEnds: string[];
};

function finiteOrNull(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function positiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function latestAnnual(periods: StatementSnapshot[]): StatementSnapshot | null {
  return (
    [...periods]
      .filter((row) => row.statementType === "annual")
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null
  );
}

function latestClose(bars: PriceBarSnapshot[]): { close: number; barDate: string } | null {
  const eligible = bars
    .filter((bar) => positiveFinite(bar.close))
    .sort((a, b) => b.barDate.localeCompare(a.barDate));
  const hit = eligible[0];
  if (!hit || !positiveFinite(hit.close)) return null;
  return { close: hit.close, barDate: hit.barDate };
}

function bookValuePerShare(
  equity: number | null,
  shares: number | null,
): { value: number | null; reason: string | null } {
  if (equity === null || !Number.isFinite(equity)) {
    return { value: null, reason: "Equity is unavailable" };
  }
  if (equity <= 0) {
    return { value: null, reason: "Equity is zero or negative — book method is unavailable" };
  }
  if (shares === null || !Number.isFinite(shares)) {
    return { value: null, reason: "Shares are unavailable" };
  }
  if (shares <= 0) {
    return { value: null, reason: "Shares are zero or negative — book method is unavailable" };
  }
  const book = equity / shares;
  if (!Number.isFinite(book) || book <= 0) {
    return {
      value: null,
      reason: "Book value per share is zero or negative — book method is unavailable",
    };
  }
  return { value: book, reason: null };
}

function currentFundamentals(periods: StatementSnapshot[]): CurrentFundamentals {
  const row = latestAnnual(periods);
  if (!row) {
    return {
      periodEnd: null,
      availableAt: null,
      equity: null,
      shares: null,
      bookValuePerShare: null,
      bookUnavailableReason: "No latest annual period",
    };
  }
  const book = bookValuePerShare(finiteOrNull(row.equity), finiteOrNull(row.shares));
  return {
    periodEnd: row.periodEnd,
    availableAt: row.availableAt,
    equity: finiteOrNull(row.equity),
    shares: finiteOrNull(row.shares),
    bookValuePerShare: book.value,
    bookUnavailableReason: book.reason,
  };
}

function peerMultiples(rows: PeerUniverseRow[]): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = metricFromInputs("price_to_book", row.lastClose, row).value;
    if (positiveFinite(value)) values.push(value);
  }
  return values;
}

function historyMultiples(points: HistoricalPoint[]): MultipleSample {
  const values: number[] = [];
  const priceDates: string[] = [];
  const periodEnds: string[] = [];
  const seenPeriodEnds = new Set<string>();
  for (const point of points) {
    if (seenPeriodEnds.has(point.periodEnd)) continue;
    seenPeriodEnds.add(point.periodEnd);
    const value = metricFromInputs("price_to_book", point.close, point).value;
    if (!positiveFinite(value)) continue;
    values.push(value);
    priceDates.push(point.priceDate);
    periodEnds.push(point.periodEnd);
  }
  return { values, priceDates, periodEnds };
}

function methodShell(args: {
  id: FairValueMethodId;
  label: string;
  kind: FairValueMethodKind;
  formula: string;
  medianName: string;
  fundamentals: CurrentFundamentals;
  valuationDate: string | null;
  peerGroup: string | null;
  lookAheadSafe: boolean | null;
}): FairValueMethodEvidence {
  return {
    id: args.id,
    label: args.label,
    kind: args.kind,
    available: false,
    methodValue: null,
    formula: args.formula,
    currentInput: null,
    currentInputName: "book_value_per_share",
    medianMultiple: null,
    medianName: args.medianName,
    sampleSize: null,
    peerGroup: args.kind === "peer" ? args.peerGroup : null,
    peerCount: null,
    historicalSampleCount: null,
    fundamentalsPeriodEnd: args.fundamentals.periodEnd,
    valuationDate: args.valuationDate,
    priceDates: null,
    historicalPeriodEnds: null,
    lookAheadSafe: args.lookAheadSafe,
    unavailableReason: null,
  };
}

function applyMultiple(args: {
  evidence: FairValueMethodEvidence;
  currentInput: number | null;
  inputReason: string | null;
  sample: number[];
  minSample: number;
  sampleNoun: string;
  priceDates?: string[] | null;
  periodEnds?: string[] | null;
  blockedReason?: string | null;
}): FairValueMethodEvidence {
  const evidence = args.evidence;
  evidence.currentInput = args.currentInput;
  evidence.sampleSize = args.sample.length;
  if (evidence.kind === "peer") evidence.peerCount = args.sample.length;
  if (evidence.kind === "history") evidence.historicalSampleCount = args.sample.length;
  evidence.priceDates = args.priceDates ?? null;
  evidence.historicalPeriodEnds = args.periodEnds ?? null;

  if (args.blockedReason) {
    evidence.unavailableReason = args.blockedReason;
    return evidence;
  }
  if (args.inputReason || !positiveFinite(args.currentInput)) {
    evidence.unavailableReason = args.inputReason ?? "Current input is unavailable";
    return evidence;
  }
  if (args.sample.length < args.minSample) {
    evidence.unavailableReason = `${args.sampleNoun} is ${args.sample.length}, need ${args.minSample} finite values above zero. Non-finite, zero, and negative multiples are excluded.`;
    return evidence;
  }
  const mid = median(args.sample);
  if (!positiveFinite(mid)) {
    evidence.unavailableReason = "Median multiple is not finite and above zero";
    return evidence;
  }
  const value = args.currentInput * mid;
  if (!positiveFinite(value)) {
    evidence.unavailableReason = "Method value is not a finite number above zero";
    return evidence;
  }
  evidence.available = true;
  evidence.methodValue = value;
  evidence.medianMultiple = mid;
  evidence.unavailableReason = null;
  return evidence;
}

function confidenceFor(args: {
  methods: FairValueMethodEvidence[];
  freshness: FreshnessBand;
}): FairValueConfidence {
  const valid = args.methods.filter((method) => method.available && positiveFinite(method.methodValue));
  if (valid.length === 0) return "UNAVAILABLE";
  if (args.freshness === "VERY_STALE") return "LOW";
  if (valid.length === 1) return "LOW";
  const freshEnough = args.freshness === "FRESH" || args.freshness === "AGING";
  if (!freshEnough) return "LOW";
  const peerMethods = valid.filter((method) => method.kind === "peer");
  const peerOk = peerMethods.every((method) => (method.peerCount ?? 0) >= MIN_USABLE_PEERS);
  // This model emits two methods, so the three-method HIGH branch does not apply.
  if (valid.length >= 3 && peerOk) return "HIGH";
  return "MEDIUM";
}

function combine(values: number[]): {
  low: number | null;
  base: number | null;
  high: number | null;
} {
  const usable = values.filter((value) => positiveFinite(value));
  if (usable.length === 0) return { low: null, base: null, high: null };
  const base = median(usable);
  if (!positiveFinite(base)) return { low: null, base: null, high: null };
  if (usable.length === 1) return { low: null, base, high: null };
  return { low: Math.min(...usable), base, high: Math.max(...usable) };
}

function differenceVsPrice(base: number | null, price: number | null): number | null {
  if (!positiveFinite(price) || !positiveFinite(base)) return null;
  const diff = (base - price) / price;
  return Number.isFinite(diff) ? diff : null;
}

function unsupportedProfile(args: {
  ticker: string;
  researchProfile: ResearchProfile;
  price: { close: number; barDate: string } | null;
  fundamentals: CurrentFundamentals;
  freshness: FreshnessBand;
  ageMonths: number | null;
  observationDate: string | null;
}): FairValueResult {
  const assumptions: FairValueAssumptions = {
    modelVersion: REIT_FAIR_VALUE_MODEL_VERSION,
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
    freshness: args.freshness,
    freshnessObservationDate: args.observationDate,
    freshnessAgeMonths: args.ageMonths,
    currentPriceDate: args.price?.barDate ?? null,
    fundamentalsPeriodEnd: args.fundamentals.periodEnd,
    excludedApproaches: EXCLUDED_APPROACHES,
  };
  return {
    ticker: args.ticker,
    researchProfile: args.researchProfile,
    modelVersion: REIT_FAIR_VALUE_MODEL_VERSION,
    valuationDate: args.price?.barDate ?? null,
    fundamentalsPeriodEnd: args.fundamentals.periodEnd,
    currentPrice: args.price?.close ?? null,
    fairValueLow: null,
    fairValueBase: null,
    fairValueHigh: null,
    differenceVsPrice: null,
    confidence: "UNAVAILABLE",
    methods: [],
    assumptions,
    unavailableReason: `Fair Value model ${REIT_FAIR_VALUE_MODEL_VERSION} calculates REIT profiles only. ${args.researchProfile} is not calculated.`,
  };
}

/**
 * REIT accounting-book Fair Value from stored equity, shares, and prices.
 * Does not fetch data, does not read YAML score bands, and does not use NAV, DPU, or cash flow.
 */
export function calculateReitFairValue(args: {
  ticker: string;
  researchProfile: ResearchProfile;
  industry?: string | null;
  sector?: string | null;
  periods: StatementSnapshot[];
  bars: PriceBarSnapshot[];
  peers: PeerUniverseRow[];
  /** Clock for freshness. Filing age uses available_at, else period_end. Never retrieved_at. */
  asOf: string;
}): FairValueResult {
  const price = latestClose(args.bars);
  const fundamentals = currentFundamentals(args.periods);
  const freshness = assessObservationFreshness({
    asOf: args.asOf,
    periodEnd: fundamentals.periodEnd,
    availableAt: fundamentals.availableAt,
  });

  if (args.researchProfile !== "REIT") {
    return unsupportedProfile({
      ticker: args.ticker,
      researchProfile: args.researchProfile,
      price,
      fundamentals,
      freshness: freshness.band,
      ageMonths: freshness.ageMonths,
      observationDate: freshness.observationDate,
    });
  }

  const history = buildHistoricalPoints(args.periods, args.bars);
  const histStatus: HistoricalValuationStatus = historicalValuationStatus({
    pointCount: history.points.length,
    allPointsHaveAvailableAt: history.lookAheadSafe,
  });
  const historicalLimitation =
    history.points.length === 0
      ? null
      : history.lookAheadSafe
        ? FILING_ALIGNED_LIMITATION
        : PERIOD_END_LIMITATION;

  const selected = selectPeerSet({
    ticker: args.ticker,
    researchProfile: "REIT",
    industry: args.industry ?? null,
    sector: args.sector ?? null,
    peers: args.peers,
    voteMetricIds: [...REIT_VOTE_METRICS],
    metricValue: (id, row) => metricFromInputs(id, row.lastClose, row).value,
  });
  const peerBlocked =
    selected.qualityBase.groupType === "NONE" || selected.rows.length < MIN_USABLE_PEERS
      ? selected.qualityBase.unavailableReason ??
        `Peer sample is too small (need ${MIN_USABLE_PEERS} usable names).`
      : !positiveFinite(price?.close)
        ? "Current price is unavailable"
        : null;
  const peerGroup = selected.qualityBase.selectionPath;
  const pbHistory = historyMultiples(history.points);

  const methods: FairValueMethodEvidence[] = [
    applyMultiple({
      evidence: methodShell({
        id: "book_peer_pb",
        label: "Accounting book × peer median P/B",
        kind: "peer",
        formula: "book value per share × peer median P/B",
        medianName: "peer_median_pb",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup,
        lookAheadSafe: null,
      }),
      currentInput: fundamentals.bookValuePerShare,
      inputReason: fundamentals.bookUnavailableReason,
      sample: peerMultiples(selected.rows),
      minSample: MIN_USABLE_PEERS,
      sampleNoun: "Peer P/B sample",
      blockedReason: peerBlocked,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "book_history_pb",
        label: "Accounting book × own historical median P/B",
        kind: "history",
        formula: "book value per share × own historical median P/B",
        medianName: "historical_median_pb",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup: null,
        lookAheadSafe: history.lookAheadSafe,
      }),
      currentInput: fundamentals.bookValuePerShare,
      inputReason: fundamentals.bookUnavailableReason,
      sample: pbHistory.values,
      minSample: MIN_HISTORICAL_POINTS,
      sampleNoun: "Historical P/B sample",
      priceDates: pbHistory.priceDates,
      periodEnds: pbHistory.periodEnds,
    }),
  ];

  const combined = combine(
    methods.flatMap((method) => (positiveFinite(method.methodValue) ? [method.methodValue] : [])),
  );
  const confidence = confidenceFor({ methods, freshness: freshness.band });
  const unavailableReason =
    confidence === "UNAVAILABLE"
      ? methods.map((method) => `${method.label}: ${method.unavailableReason ?? "unavailable"}`).join(" ")
      : null;

  const assumptions: FairValueAssumptions = {
    modelVersion: REIT_FAIR_VALUE_MODEL_VERSION,
    researchProfile: "REIT",
    modelDefaultsUsed: false,
    yamlScoreBandsUsed: false,
    peerGroupType: selected.qualityBase.groupType,
    peerSelectionPath: selected.qualityBase.selectionPath,
    peerEligibleCount: selected.qualityBase.eligibleCount,
    peerUnavailableReason: selected.qualityBase.unavailableReason,
    historicalPointCount: history.points.length,
    lookAheadSafe: history.lookAheadSafe,
    historicalValuationStatus: histStatus,
    historicalLimitation,
    freshness: freshness.band,
    freshnessObservationDate: freshness.observationDate,
    freshnessAgeMonths: freshness.ageMonths,
    currentPriceDate: price?.barDate ?? null,
    fundamentalsPeriodEnd: fundamentals.periodEnd,
    excludedApproaches: EXCLUDED_APPROACHES,
  };

  return {
    ticker: args.ticker,
    researchProfile: "REIT",
    modelVersion: REIT_FAIR_VALUE_MODEL_VERSION,
    valuationDate: price?.barDate ?? null,
    fundamentalsPeriodEnd: fundamentals.periodEnd,
    currentPrice: price?.close ?? null,
    fairValueLow: combined.low,
    fairValueBase: combined.base,
    fairValueHigh: combined.high,
    differenceVsPrice: differenceVsPrice(combined.base, price?.close ?? null),
    confidence,
    methods,
    assumptions,
    unavailableReason,
  };
}
