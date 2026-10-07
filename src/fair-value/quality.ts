import type {
  FairValueMethodEvidence,
  FairValueMethodId,
  FairValueResult,
} from "@/fair-value/types";

/** Data-quality labels for a finished Fair Value result. Separate from calculator confidence. */
export const FAIR_VALUE_QUALITY_STATUSES = ["CLEAR", "FLAGGED", "NO_VALUE"] as const;
export type FairValueQualityStatus = (typeof FAIR_VALUE_QUALITY_STATUSES)[number];

/** Whether the calculator base can be read as a settled point. The base itself is not replaced. */
export const FAIR_VALUE_BASE_USES = [
  "POINT_OK",
  "POINT_WITH_CAUTION",
  "POINT_WITHHELD",
  "NO_POINT",
] as const;
export type FairValueBaseUse = (typeof FAIR_VALUE_BASE_USES)[number];

export const FAIR_VALUE_METHOD_QUALITY_STATES = ["CLEAR", "FLAGGED", "ABSENT"] as const;
export type FairValueMethodQualityState = (typeof FAIR_VALUE_METHOD_QUALITY_STATES)[number];

/** Codes that mark a calculated method FLAGGED. */
export const FAIR_VALUE_QUALITY_FLAG_CODES = [
  "EPS_SCALE_BREAK_VS_OWN_HISTORY",
  "EPS_VS_PAT_SHARES_UNRESOLVED",
  "EPS_PAT_SIGN_CONFLICT",
  "EPS_YOY_DISCONTINUITY",
] as const;
export type FairValueQualityFlagCode = (typeof FAIR_VALUE_QUALITY_FLAG_CODES)[number];

/** Informational codes. They do not change status, base use, or confidence. */
export const FAIR_VALUE_QUALITY_NOTE_CODES = [
  "EPS_GAP_NOTE",
  "EPS_PAT_SIGN_CONFLICT",
  "EPS_EXPLICIT_ZERO_PAT_POSITIVE",
  "SPREAD_AT_LEAST_2X",
  "SPREAD_AT_LEAST_10X",
  "EXTRAORDINARY_VERSUS_PRICE",
  "EXTRAORDINARY_DIVIDEND_YIELD",
] as const;
export type FairValueQualityNoteCode = (typeof FAIR_VALUE_QUALITY_NOTE_CODES)[number];

export type FairValueQualityAnnual = {
  periodEnd: string;
  eps: number | null;
  pat: number | null;
  shares: number | null;
  dividendPerShare: number | null;
};

export type FairValueQualityFlag = {
  code: FairValueQualityFlagCode;
  text: string;
};

export type FairValueQualityNote = {
  code: FairValueQualityNoteCode;
  text: string;
};

export type FairValueMethodQuality = {
  id: FairValueMethodId;
  state: FairValueMethodQualityState;
  flags: FairValueQualityFlag[];
  notes: FairValueQualityNote[];
};

export type FairValueQuality = {
  status: FairValueQualityStatus;
  baseUse: FairValueBaseUse;
  methods: FairValueMethodQuality[];
  notes: FairValueQualityNote[];
  historicalLimitation: string | null;
};

const FLAG_TEXT: Record<FairValueQualityFlagCode, string> = {
  EPS_SCALE_BREAK_VS_OWN_HISTORY:
    "Latest EPS is about 100× or more away from PAT / shares, after an older year in which the two matched. PAT / shares was not substituted.",
  EPS_VS_PAT_SHARES_UNRESOLVED:
    "Latest EPS and PAT / shares differ by more than 3×. PAT / shares was not substituted.",
  EPS_PAT_SIGN_CONFLICT: "Stored EPS and PAT have opposite signs.",
  EPS_YOY_DISCONTINUITY:
    "EPS moved by at least 20× from the prior year while PAT did not move by a similar factor.",
};

const NOTE_TEXT: Record<FairValueQualityNoteCode, string> = {
  EPS_GAP_NOTE:
    "Stored EPS and PAT / shares differ by more than 10% and by less than 3×. The earnings method is not flagged.",
  EPS_PAT_SIGN_CONFLICT:
    "Stored EPS and PAT have opposite signs. The earnings method was not calculated, and PAT / shares was not substituted.",
  EPS_EXPLICIT_ZERO_PAT_POSITIVE:
    "Stored EPS is zero while PAT is positive. EPS was not replaced, and the earnings method stays absent.",
  SPREAD_AT_LEAST_2X: "The valuation methods differ by at least 2×.",
  SPREAD_AT_LEAST_10X: "The valuation methods differ by at least 10×.",
  EXTRAORDINARY_VERSUS_PRICE:
    "This method's value is at least 10× the price used, or at most one tenth of that price.",
  EXTRAORDINARY_DIVIDEND_YIELD: "Dividend per share is at least 25% of the price used.",
};

const POWER_OF_TEN_TOLERANCE = 0.08;
const EPS_MATCH_BAND = 0.1;
const EPS_FLOOR = 0.01;
/** PAT must stay inside this band for an EPS jump to count as a discontinuity. */
const PAT_STABLE_LOW = 0.2;
const PAT_STABLE_HIGH = 5;
const EPS_YOY_MULTIPLE = 20;
const UNRESOLVED_RATIO_LOW = 1 / 3;
const UNRESOLVED_RATIO_HIGH = 3;
const SPREAD_2X = 2;
const SPREAD_10X = 10;
const EXTRAORDINARY_PRICE_MULTIPLE = 10;
const EXTRAORDINARY_YIELD = 0.25;

type EpsInspection = {
  flags: FairValueQualityFlagCode[];
  notes: FairValueQualityNoteCode[];
  absentNotes: FairValueQualityNoteCode[];
};

/**
 * Read a finished Fair Value result and the annuals that fed it.
 * Does not recalculate Fair Value, and does not write either input.
 */
export function assessFairValueQuality(
  result: FairValueResult,
  annuals: readonly FairValueQualityAnnual[],
): FairValueQuality {
  const inspection = inspectEarnings(annuals);
  const latestDividend = latestDividendPerShare(annuals);
  const methods = result.methods.map((method) =>
    assessMethod(method, result.currentPrice, latestDividend, inspection),
  );
  const decision = decideStatus(result, methods);
  const notes: FairValueQualityNote[] = [];
  const spread = spreadNote(result);
  if (spread) notes.push(spread);
  return {
    status: decision.status,
    baseUse: decision.baseUse,
    methods,
    notes,
    historicalLimitation: result.assumptions.historicalLimitation,
  };
}

function assessMethod(
  method: FairValueMethodEvidence,
  currentPrice: number | null,
  latestDividend: number | null,
  inspection: EpsInspection,
): FairValueMethodQuality {
  const calculated = isCalculated(method);
  const flags: FairValueQualityFlagCode[] = [];
  const notes: FairValueQualityNoteCode[] = [];

  if (isEarningsMethod(method)) {
    if (calculated) {
      flags.push(...inspection.flags);
      notes.push(...inspection.notes);
    } else {
      notes.push(...inspection.absentNotes);
    }
  }

  if (calculated && extraordinaryVersusPrice(method.methodValue, currentPrice)) {
    notes.push("EXTRAORDINARY_VERSUS_PRICE");
  }
  if (
    calculated &&
    isDividendMethod(method) &&
    extraordinaryDividendYield(latestDividend, currentPrice)
  ) {
    notes.push("EXTRAORDINARY_DIVIDEND_YIELD");
  }

  return {
    id: method.id,
    state: !calculated ? "ABSENT" : flags.length > 0 ? "FLAGGED" : "CLEAR",
    flags: flags.map(flag),
    notes: notes.map(note),
  };
}

function decideStatus(
  result: FairValueResult,
  methods: FairValueMethodQuality[],
): { status: FairValueQualityStatus; baseUse: FairValueBaseUse } {
  const calculated = result.methods.filter(isCalculated);
  if (calculated.length === 0) return { status: "NO_VALUE", baseUse: "NO_POINT" };

  const qualityById = new Map(methods.map((method) => [method.id, method]));
  const flaggedCount = calculated.filter((method) => qualityById.get(method.id)?.state === "FLAGGED").length;
  if (flaggedCount === 0) return { status: "CLEAR", baseUse: "POINT_OK" };
  if (flaggedCount === calculated.length) return { status: "FLAGGED", baseUse: "POINT_WITHHELD" };

  const cleanValues = calculated
    .filter((method) => qualityById.get(method.id)?.state === "CLEAR")
    .map((method) => method.methodValue as number);
  const matchesCleanValue = cleanValues.some((value) => sameValue(value, result.fairValueBase));
  const matchesCleanMedian = sameValue(median(cleanValues), result.fairValueBase);
  return {
    status: "FLAGGED",
    baseUse: matchesCleanValue || matchesCleanMedian ? "POINT_WITH_CAUTION" : "POINT_WITHHELD",
  };
}

function inspectEarnings(annuals: readonly FairValueQualityAnnual[]): EpsInspection {
  const empty: EpsInspection = { flags: [], notes: [], absentNotes: [] };
  if (annuals.length === 0) return empty;
  const ordered = [...annuals].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const latest = ordered[ordered.length - 1];
  if (!latest) return empty;
  const eps = finite(latest.eps);
  const pat = finite(latest.pat);
  const shares = finite(latest.shares);

  if (eps === 0 && pat != null && pat > 0) {
    return { flags: [], notes: [], absentNotes: ["EPS_EXPLICIT_ZERO_PAT_POSITIVE"] };
  }
  if (eps != null && pat != null && ((eps > 0 && pat < 0) || (eps < 0 && pat > 0))) {
    if (eps > 0) return { flags: ["EPS_PAT_SIGN_CONFLICT"], notes: [], absentNotes: [] };
    return { flags: [], notes: [], absentNotes: ["EPS_PAT_SIGN_CONFLICT"] };
  }
  if (eps == null || pat == null || shares == null || shares <= 0) return empty;

  const implied = pat / shares;
  if (!(eps > 0 && implied > 0)) return empty;

  const flags: FairValueQualityFlagCode[] = [];
  const notes: FairValueQualityNoteCode[] = [];
  const ratio = eps / implied;
  const gap = relativeGap(eps, implied);
  const olderMatch = ordered.slice(0, -1).some((row) => annualMatches(row));
  const exponent = powerOfTenExponent(ratio);
  const scaleBreak = olderMatch && exponent != null && Math.abs(exponent) >= 2;
  if (scaleBreak) flags.push("EPS_SCALE_BREAK_VS_OWN_HISTORY");
  else if (ratio < UNRESOLVED_RATIO_LOW || ratio > UNRESOLVED_RATIO_HIGH) {
    flags.push("EPS_VS_PAT_SHARES_UNRESOLVED");
  } else if (gap > EPS_MATCH_BAND) notes.push("EPS_GAP_NOTE");

  const prior = ordered.length >= 2 ? ordered[ordered.length - 2] : null;
  if (prior && yearOverYearDiscontinuity(latest, prior)) flags.push("EPS_YOY_DISCONTINUITY");
  return { flags, notes, absentNotes: [] };
}

function annualMatches(row: FairValueQualityAnnual): boolean {
  const eps = finite(row.eps);
  const pat = finite(row.pat);
  const shares = finite(row.shares);
  if (eps == null || pat == null || shares == null || shares <= 0 || eps <= 0 || pat <= 0) return false;
  const implied = pat / shares;
  if (!(implied > 0)) return false;
  return relativeGap(eps, implied) <= EPS_MATCH_BAND;
}

function yearOverYearDiscontinuity(latest: FairValueQualityAnnual, prior: FairValueQualityAnnual): boolean {
  const eps = finite(latest.eps);
  const priorEps = finite(prior.eps);
  const pat = finite(latest.pat);
  const priorPat = finite(prior.pat);
  if (eps == null || priorEps == null || pat == null || priorPat == null) return false;
  if (eps < EPS_FLOOR || priorEps < EPS_FLOOR) return false;
  if (pat <= 0 || priorPat <= 0) return false;
  const epsMultiple = eps / priorEps;
  const patMultiple = pat / priorPat;
  const epsJumped = epsMultiple >= EPS_YOY_MULTIPLE || epsMultiple <= 1 / EPS_YOY_MULTIPLE;
  const patStable = patMultiple > PAT_STABLE_LOW && patMultiple < PAT_STABLE_HIGH;
  return epsJumped && patStable;
}

function spreadNote(result: FairValueResult): FairValueQualityNote | null {
  const low = result.fairValueLow;
  const high = result.fairValueHigh;
  if (low == null || high == null || !(low > 0) || !(high > 0)) return null;
  const ratio = high / low;
  if (ratio >= SPREAD_10X) return note("SPREAD_AT_LEAST_10X");
  if (ratio >= SPREAD_2X) return note("SPREAD_AT_LEAST_2X");
  return null;
}

function extraordinaryVersusPrice(methodValue: number | null, currentPrice: number | null): boolean {
  if (methodValue == null || currentPrice == null || !(currentPrice > 0) || !(methodValue > 0)) return false;
  return methodValue >= currentPrice * EXTRAORDINARY_PRICE_MULTIPLE || methodValue <= currentPrice / EXTRAORDINARY_PRICE_MULTIPLE;
}

function extraordinaryDividendYield(dividendPerShare: number | null, currentPrice: number | null): boolean {
  if (dividendPerShare == null || currentPrice == null || !(currentPrice > 0) || !(dividendPerShare > 0)) return false;
  return dividendPerShare / currentPrice >= EXTRAORDINARY_YIELD;
}

function latestDividendPerShare(annuals: readonly FairValueQualityAnnual[]): number | null {
  if (annuals.length === 0) return null;
  const ordered = [...annuals].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const latest = ordered[ordered.length - 1];
  return latest ? finite(latest.dividendPerShare) : null;
}

function isCalculated(method: FairValueMethodEvidence): boolean {
  return method.available && method.methodValue != null && Number.isFinite(method.methodValue) && method.methodValue > 0;
}

function isEarningsMethod(method: FairValueMethodEvidence): boolean {
  return method.currentInputName === "eps";
}

function isDividendMethod(method: FairValueMethodEvidence): boolean {
  return method.currentInputName === "dividend_per_share";
}

function powerOfTenExponent(ratio: number): number | null {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  const log = Math.log10(ratio);
  const nearest = Math.round(log);
  if (Math.abs(nearest) < 1) return null;
  if (Math.abs(log - nearest) > POWER_OF_TEN_TOLERANCE) return null;
  return nearest;
}

function relativeGap(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right));
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sameValue(left: number | null, right: number | null): boolean {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  return Math.abs(left - right) <= scale * 1e-9;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lower = sorted[mid - 1];
    const upper = sorted[mid];
    if (lower == null || upper == null) return null;
    return (lower + upper) / 2;
  }
  return sorted[mid] ?? null;
}

function flag(code: FairValueQualityFlagCode): FairValueQualityFlag {
  return { code, text: FLAG_TEXT[code] };
}

function note(code: FairValueQualityNoteCode): FairValueQualityNote {
  return { code, text: NOTE_TEXT[code] };
}
