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
  FAIR_VALUE_MODEL_VERSION,
  type FairValueAssumptions,
  type FairValueConfidence,
  type FairValueMethodEvidence,
  type FairValueMethodId,
  type FairValueMethodKind,
  type FairValueResult,
} from "@/fair-value/types";

const FILING_ALIGNED_LIMITATION =
  "Historical series uses price on or before each filing’s available_at with that period’s line items.";

const GENERAL_VOTE_METRICS = ["price_to_earnings", "price_to_book", "dividend_yield"] as const;

type CurrentFundamentals = {
  periodEnd: string | null;
  availableAt: string | null;
  eps: number | null;
  equity: number | null;
  shares: number | null;
  dividendPerShare: number | null;
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
      eps: null,
      equity: null,
      shares: null,
      dividendPerShare: null,
      bookValuePerShare: null,
      bookUnavailableReason: "No latest annual period",
    };
  }
  const book = bookValuePerShare(finiteOrNull(row.equity), finiteOrNull(row.shares));
  return {
    periodEnd: row.periodEnd,
    availableAt: row.availableAt,
    eps: finiteOrNull(row.eps),
    equity: finiteOrNull(row.equity),
    shares: finiteOrNull(row.shares),
    dividendPerShare: finiteOrNull(row.dividendPerShare),
    bookValuePerShare: book.value,
    bookUnavailableReason: book.reason,
  };
}

function earningsInputReason(eps: number | null): string | null {
  if (eps === null) return "EPS is unavailable";
  if (eps <= 0) return "EPS is zero or negative — P/E method is unavailable";
  return null;
}

function dividendInputReason(dps: number | null): string | null {
  if (dps === null) return "Dividend per share is unavailable — not treated as zero";
  if (dps <= 0) return "Dividend per share is zero or negative — dividend method is unavailable";
  return null;
}

function peerMultiples(metricId: string, rows: PeerUniverseRow[]): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = metricFromInputs(metricId, row.lastClose, row).value;
    if (positiveFinite(value)) values.push(value);
  }
  return values;
}

function historyMultiples(metricId: string, points: HistoricalPoint[]): MultipleSample {
  const values: number[] = [];
  const priceDates: string[] = [];
  const periodEnds: string[] = [];
  for (const point of points) {
    const value = metricFromInputs(metricId, point.close, point).value;
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
  currentInputName: FairValueMethodEvidence["currentInputName"];
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
    currentInputName: args.currentInputName,
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
  /** P/E and P/B multiply. Dividend yield divides. */
  combine: "multiply" | "divide";
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
  const value = args.combine === "divide" ? args.currentInput / mid : args.currentInput * mid;
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
  // VERY_STALE lowers the label only. Method values are unchanged.
  if (args.freshness === "VERY_STALE") return "LOW";
  if (valid.length === 1) return "LOW";
  const freshEnough = args.freshness === "FRESH" || args.freshness === "AGING";
  if (!freshEnough) return "LOW";
  const peerMethods = valid.filter((method) => method.kind === "peer");
  const peerOk = peerMethods.every((method) => (method.peerCount ?? 0) >= MIN_USABLE_PEERS);
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
    modelVersion: FAIR_VALUE_MODEL_VERSION,
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
  };
  return {
    ticker: args.ticker,
    researchProfile: args.researchProfile,
    modelVersion: FAIR_VALUE_MODEL_VERSION,
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
    unavailableReason: `Fair Value model ${FAIR_VALUE_MODEL_VERSION} calculates GENERAL profiles only. ${args.researchProfile} is not calculated.`,
  };
}

/**
 * GENERAL relative Fair Value from stored prices, annuals, and the existing peer set.
 * Does not fetch data, does not read YAML score bands, and does not score the name.
 */
export function calculateGeneralFairValue(args: {
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

  if (args.researchProfile !== "GENERAL") {
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
    researchProfile: "GENERAL",
    industry: args.industry ?? null,
    sector: args.sector ?? null,
    peers: args.peers,
    voteMetricIds: [...GENERAL_VOTE_METRICS],
    metricValue: (id, row) => metricFromInputs(id, row.lastClose, row).value,
  });
  const peerBlocked =
    selected.qualityBase.groupType === "NONE" || selected.rows.length < MIN_USABLE_PEERS
      ? selected.qualityBase.unavailableReason ??
        `Peer sample is too small (need ${MIN_USABLE_PEERS} usable names).`
      : null;
  const peerGroup = selected.qualityBase.selectionPath;

  const earningsReason = earningsInputReason(fundamentals.eps);
  const dividendReason = dividendInputReason(fundamentals.dividendPerShare);
  const peHistory = historyMultiples("price_to_earnings", history.points);
  const pbHistory = historyMultiples("price_to_book", history.points);
  const yieldHistory = historyMultiples("dividend_yield", history.points);

  const methods: FairValueMethodEvidence[] = [
    applyMultiple({
      evidence: methodShell({
        id: "earnings_peer_pe",
        label: "Earnings × peer median P/E",
        kind: "peer",
        formula: "EPS × peer median P/E",
        currentInputName: "eps",
        medianName: "peer_median_pe",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup,
        lookAheadSafe: null,
      }),
      currentInput: fundamentals.eps,
      inputReason: earningsReason,
      sample: peerMultiples("price_to_earnings", selected.rows),
      minSample: MIN_USABLE_PEERS,
      sampleNoun: "Peer P/E sample",
      combine: "multiply",
      blockedReason: peerBlocked,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "earnings_history_pe",
        label: "Earnings × own historical median P/E",
        kind: "history",
        formula: "EPS × own historical median P/E",
        currentInputName: "eps",
        medianName: "historical_median_pe",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup: null,
        lookAheadSafe: history.lookAheadSafe,
      }),
      currentInput: fundamentals.eps,
      inputReason: earningsReason,
      sample: peHistory.values,
      minSample: MIN_HISTORICAL_POINTS,
      sampleNoun: "Historical P/E sample",
      combine: "multiply",
      priceDates: peHistory.priceDates,
      periodEnds: peHistory.periodEnds,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "book_peer_pb",
        label: "Book value × peer median P/B",
        kind: "peer",
        formula: "book value per share × peer median P/B",
        currentInputName: "book_value_per_share",
        medianName: "peer_median_pb",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup,
        lookAheadSafe: null,
      }),
      currentInput: fundamentals.bookValuePerShare,
      inputReason: fundamentals.bookUnavailableReason,
      sample: peerMultiples("price_to_book", selected.rows),
      minSample: MIN_USABLE_PEERS,
      sampleNoun: "Peer P/B sample",
      combine: "multiply",
      blockedReason: peerBlocked,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "book_history_pb",
        label: "Book value × own historical median P/B",
        kind: "history",
        formula: "book value per share × own historical median P/B",
        currentInputName: "book_value_per_share",
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
      combine: "multiply",
      priceDates: pbHistory.priceDates,
      periodEnds: pbHistory.periodEnds,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "dividend_peer_yield",
        label: "DPS ÷ peer median dividend yield",
        kind: "peer",
        formula: "DPS / peer median dividend yield",
        currentInputName: "dividend_per_share",
        medianName: "peer_median_dividend_yield",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup,
        lookAheadSafe: null,
      }),
      currentInput: fundamentals.dividendPerShare,
      inputReason: dividendReason,
      sample: peerMultiples("dividend_yield", selected.rows),
      minSample: MIN_USABLE_PEERS,
      sampleNoun: "Peer dividend-yield sample",
      combine: "divide",
      blockedReason: peerBlocked,
    }),
    applyMultiple({
      evidence: methodShell({
        id: "dividend_history_yield",
        label: "DPS ÷ own historical median dividend yield",
        kind: "history",
        formula: "DPS / own historical median dividend yield",
        currentInputName: "dividend_per_share",
        medianName: "historical_median_dividend_yield",
        fundamentals,
        valuationDate: price?.barDate ?? null,
        peerGroup: null,
        lookAheadSafe: history.lookAheadSafe,
      }),
      currentInput: fundamentals.dividendPerShare,
      inputReason: dividendReason,
      sample: yieldHistory.values,
      minSample: MIN_HISTORICAL_POINTS,
      sampleNoun: "Historical dividend-yield sample",
      combine: "divide",
      priceDates: yieldHistory.priceDates,
      periodEnds: yieldHistory.periodEnds,
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
    modelVersion: FAIR_VALUE_MODEL_VERSION,
    researchProfile: "GENERAL",
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
  };

  return {
    ticker: args.ticker,
    researchProfile: "GENERAL",
    modelVersion: FAIR_VALUE_MODEL_VERSION,
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
