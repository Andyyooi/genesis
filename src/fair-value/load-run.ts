import type Database from "better-sqlite3";
import {
  FAIR_VALUE_BASE_USES,
  FAIR_VALUE_METHOD_QUALITY_STATES,
  FAIR_VALUE_QUALITY_FLAG_CODES,
  FAIR_VALUE_QUALITY_NOTE_CODES,
  FAIR_VALUE_QUALITY_STATUSES,
  type FairValueQuality,
} from "@/fair-value/quality";
import {
  FAIR_VALUE_CONFIDENCE_LEVELS,
  FAIR_VALUE_METHOD_IDS,
  type FairValueAssumptions,
  type FairValueMethodEvidence,
  type FairValueResult,
} from "@/fair-value/types";
import { RESEARCH_PROFILES } from "@/research/profiles";

/**
 * The only quality-gate generation this reader knows how to parse.
 * Kept here so read-back does not import the observation-key hasher.
 */
const READABLE_QUALITY_VERSION = "fair-value-quality-v1";

const HISTORY_DEFAULT_LIMIT = 8;
const HISTORY_MAX_LIMIT = 50;

const METHOD_KINDS = ["peer", "history"] as const;
const INPUT_NAMES = ["eps", "book_value_per_share", "dividend_per_share"] as const;
const FRESHNESS_BANDS = ["FRESH", "AGING", "STALE", "VERY_STALE", "UNKNOWN"] as const;
const PEER_GROUP_TYPES = ["BANK_PROFILE", "REIT_PROFILE", "INDUSTRY", "INDUSTRY_FAMILY", "SECTOR", "NONE"] as const;
const HISTORICAL_VALUATION_STATUSES = ["POINT_IN_TIME_SAFE", "PERIOD_END_ONLY", "UNAVAILABLE"] as const;

export type FairValueRunReadCode =
  | "MALFORMED_JSON"
  | "UNKNOWN_ENUM"
  | "UNKNOWN_QUALITY_VERSION"
  | "COLUMN_MISMATCH"
  | "INCOMPLETE_ROW";

export type FairValueStoredRun = {
  id: number;
  instrumentId: number;
  calculatedAt: string;
  observationKey: string;
  qualityVersion: string;
  result: FairValueResult;
  quality: FairValueQuality;
};

export type FairValueRunRead =
  | { ok: true; run: FairValueStoredRun }
  | { ok: false; id: number; code: FairValueRunReadCode; message: string };

type SqlRow = {
  id: number;
  instrumentId: number;
  ticker: string;
  researchProfile: string;
  modelVersion: string;
  valuationDate: string | null;
  fundamentalsPeriodEnd: string | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueBase: number | null;
  fairValueHigh: number | null;
  differenceVsPrice: number | null;
  confidence: string;
  methodsJson: string;
  assumptionsJson: string;
  unavailableReason: string | null;
  calculatedAt: string;
  qualityStatus: string | null;
  baseUse: string | null;
  qualityVersion: string | null;
  qualityJson: string | null;
  observationKey: string | null;
};

const SELECT_ROW = `
  SELECT
    id,
    instrument_id AS instrumentId,
    ticker,
    research_profile AS researchProfile,
    model_version AS modelVersion,
    valuation_date AS valuationDate,
    fundamentals_period_end AS fundamentalsPeriodEnd,
    current_price AS currentPrice,
    fair_value_low AS fairValueLow,
    fair_value_base AS fairValueBase,
    fair_value_high AS fairValueHigh,
    difference_vs_price AS differenceVsPrice,
    confidence,
    methods_json AS methodsJson,
    assumptions_json AS assumptionsJson,
    unavailable_reason AS unavailableReason,
    calculated_at AS calculatedAt,
    quality_status AS qualityStatus,
    base_use AS baseUse,
    quality_version AS qualityVersion,
    quality_json AS qualityJson,
    observation_key AS observationKey
  FROM fair_value_runs
`;

/** Read one stored observation. Null means that id is absent. */
export function loadFairValueRunById(sqlite: Database.Database, id: number): FairValueRunRead | null {
  const row = sqlite.prepare(`${SELECT_ROW} WHERE id = ?`).get(id) as SqlRow | undefined;
  if (!row) return null;
  return parseStoredRow(row);
}

/**
 * Newest stored observation for one instrument and one model/quality generation.
 * Newest means the greatest row id. An unreadable newest row is returned as-is.
 */
export function loadLatestFairValueRun(
  sqlite: Database.Database,
  args: { instrumentId: number; modelVersion: string; qualityVersion: string },
): FairValueRunRead | null {
  const row = sqlite
    .prepare(
      `${SELECT_ROW}
       WHERE instrument_id = ? AND model_version = ? AND quality_version = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(args.instrumentId, args.modelVersion, args.qualityVersion) as SqlRow | undefined;
  if (!row) return null;
  return parseStoredRow(row);
}

/** Stored observations for one instrument and one model/quality generation, newest id first. */
export function loadFairValueRunHistory(
  sqlite: Database.Database,
  args: { instrumentId: number; modelVersion: string; qualityVersion: string; limit?: number },
): FairValueRunRead[] {
  const limit = resolveHistoryLimit(args.limit);
  const rows = sqlite
    .prepare(
      `${SELECT_ROW}
       WHERE instrument_id = ? AND model_version = ? AND quality_version = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(args.instrumentId, args.modelVersion, args.qualityVersion, limit) as SqlRow[];
  return rows.map(parseStoredRow);
}

function resolveHistoryLimit(limit: number | undefined): number {
  if (limit === undefined) return HISTORY_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
    throw new Error(`Fair Value history limit must be an integer from 1 to ${HISTORY_MAX_LIMIT}.`);
  }
  return limit;
}

function parseStoredRow(row: SqlRow): FairValueRunRead {
  if (
    row.qualityStatus == null ||
    row.baseUse == null ||
    row.qualityVersion == null ||
    row.qualityJson == null ||
    row.observationKey == null
  ) {
    return unreadable(row.id, "INCOMPLETE_ROW", "A required Fair Value quality column is null.");
  }
  if (row.qualityVersion !== READABLE_QUALITY_VERSION) {
    return unreadable(
      row.id,
      "UNKNOWN_QUALITY_VERSION",
      `Fair Value quality version ${row.qualityVersion} is not ${READABLE_QUALITY_VERSION}.`,
    );
  }

  let methodsRaw: unknown;
  let assumptionsRaw: unknown;
  let qualityRaw: unknown;
  try {
    methodsRaw = JSON.parse(row.methodsJson);
    assumptionsRaw = JSON.parse(row.assumptionsJson);
    qualityRaw = JSON.parse(row.qualityJson);
  } catch {
    return unreadable(row.id, "MALFORMED_JSON", "Stored Fair Value JSON could not be parsed.");
  }

  const methods = parseMethods(methodsRaw);
  if (!methods.ok) return unreadable(row.id, methods.code, methods.message);
  const assumptions = parseAssumptions(assumptionsRaw);
  if (!assumptions.ok) return unreadable(row.id, assumptions.code, assumptions.message);
  const quality = parseQuality(qualityRaw);
  if (!quality.ok) return unreadable(row.id, quality.code, quality.message);

  const confidence = parseClosed(row.confidence, FAIR_VALUE_CONFIDENCE_LEVELS, "confidence");
  if (!confidence.ok) return unreadable(row.id, confidence.code, confidence.message);
  const profile = parseClosed(row.researchProfile, RESEARCH_PROFILES, "research_profile");
  if (!profile.ok) return unreadable(row.id, profile.code, profile.message);

  if (!isNullableString(row.ticker) || row.ticker == null) {
    return unreadable(row.id, "MALFORMED_JSON", "Stored ticker is not a string.");
  }
  if (!isNullableString(row.valuationDate)) {
    return unreadable(row.id, "MALFORMED_JSON", "Stored valuation_date is not a string or null.");
  }
  if (!isNullableString(row.fundamentalsPeriodEnd)) {
    return unreadable(row.id, "MALFORMED_JSON", "Stored fundamentals_period_end is not a string or null.");
  }
  if (!isNullableString(row.unavailableReason)) {
    return unreadable(row.id, "MALFORMED_JSON", "Stored unavailable_reason is not a string or null.");
  }
  if (!isNullableString(row.calculatedAt) || row.calculatedAt == null) {
    return unreadable(row.id, "MALFORMED_JSON", "Stored calculated_at is not a string.");
  }
  const currentPrice = parseNullableNumber(row.currentPrice, "current_price");
  if (!currentPrice.ok) return unreadable(row.id, currentPrice.code, currentPrice.message);
  const fairValueLow = parseNullableNumber(row.fairValueLow, "fair_value_low");
  if (!fairValueLow.ok) return unreadable(row.id, fairValueLow.code, fairValueLow.message);
  const fairValueBase = parseNullableNumber(row.fairValueBase, "fair_value_base");
  if (!fairValueBase.ok) return unreadable(row.id, fairValueBase.code, fairValueBase.message);
  const fairValueHigh = parseNullableNumber(row.fairValueHigh, "fair_value_high");
  if (!fairValueHigh.ok) return unreadable(row.id, fairValueHigh.code, fairValueHigh.message);
  const differenceVsPrice = parseNullableNumber(row.differenceVsPrice, "difference_vs_price");
  if (!differenceVsPrice.ok) return unreadable(row.id, differenceVsPrice.code, differenceVsPrice.message);

  const mismatch = columnMismatch(row, assumptions.value, quality.value);
  if (mismatch) return unreadable(row.id, "COLUMN_MISMATCH", mismatch);

  const result: FairValueResult = {
    ticker: row.ticker,
    researchProfile: profile.value,
    modelVersion: row.modelVersion,
    valuationDate: row.valuationDate,
    fundamentalsPeriodEnd: row.fundamentalsPeriodEnd,
    currentPrice: currentPrice.value,
    fairValueLow: fairValueLow.value,
    fairValueBase: fairValueBase.value,
    fairValueHigh: fairValueHigh.value,
    differenceVsPrice: differenceVsPrice.value,
    confidence: confidence.value,
    methods: methods.value,
    assumptions: assumptions.value,
    unavailableReason: row.unavailableReason,
  };
  return {
    ok: true,
    run: {
      id: row.id,
      instrumentId: row.instrumentId,
      calculatedAt: row.calculatedAt,
      observationKey: row.observationKey,
      qualityVersion: row.qualityVersion,
      result,
      quality: quality.value,
    },
  };
}

function columnMismatch(row: SqlRow, assumptions: FairValueAssumptions, quality: FairValueQuality): string | null {
  if (row.qualityStatus !== quality.status) {
    return "quality_status does not match quality.status.";
  }
  if (row.baseUse !== quality.baseUse) {
    return "base_use does not match quality.baseUse.";
  }
  if (row.modelVersion !== assumptions.modelVersion) {
    return "model_version does not match assumptions.modelVersion.";
  }
  if (row.researchProfile !== assumptions.researchProfile) {
    return "research_profile does not match assumptions.researchProfile.";
  }
  if (row.fundamentalsPeriodEnd !== assumptions.fundamentalsPeriodEnd) {
    return "fundamentals_period_end does not match assumptions.fundamentalsPeriodEnd.";
  }
  return null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; code: FairValueRunReadCode; message: string };

function parseMethods(value: unknown): Parsed<FairValueMethodEvidence[]> {
  if (!Array.isArray(value)) return malformed("methods_json is not an array.");
  const methods: FairValueMethodEvidence[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return malformed("A Fair Value method is not an object.");
    const id = parseClosed(entry.id, FAIR_VALUE_METHOD_IDS, "method.id");
    if (!id.ok) return id;
    if (typeof entry.label !== "string") return malformed("method.label is not a string.");
    const kind = parseClosed(entry.kind, METHOD_KINDS, "method.kind");
    if (!kind.ok) return kind;
    if (typeof entry.available !== "boolean") return malformed("method.available is not a boolean.");
    const methodValue = parseNullableNumber(entry.methodValue, "method.methodValue");
    if (!methodValue.ok) return methodValue;
    if (typeof entry.formula !== "string") return malformed("method.formula is not a string.");
    const currentInput = parseNullableNumber(entry.currentInput, "method.currentInput");
    if (!currentInput.ok) return currentInput;
    const currentInputName = parseNullableClosed(entry.currentInputName, INPUT_NAMES, "method.currentInputName");
    if (!currentInputName.ok) return currentInputName;
    const medianMultiple = parseNullableNumber(entry.medianMultiple, "method.medianMultiple");
    if (!medianMultiple.ok) return medianMultiple;
    if (!isNullableString(entry.medianName)) return malformed("method.medianName is not a string or null.");
    const sampleSize = parseNullableNumber(entry.sampleSize, "method.sampleSize");
    if (!sampleSize.ok) return sampleSize;
    if (!isNullableString(entry.peerGroup)) return malformed("method.peerGroup is not a string or null.");
    const peerCount = parseNullableNumber(entry.peerCount, "method.peerCount");
    if (!peerCount.ok) return peerCount;
    const historicalSampleCount = parseNullableNumber(entry.historicalSampleCount, "method.historicalSampleCount");
    if (!historicalSampleCount.ok) return historicalSampleCount;
    if (!isNullableString(entry.fundamentalsPeriodEnd)) return malformed("method.fundamentalsPeriodEnd is not a string or null.");
    if (!isNullableString(entry.valuationDate)) return malformed("method.valuationDate is not a string or null.");
    const priceDates = parseNullableStringArray(entry.priceDates, "method.priceDates");
    if (!priceDates.ok) return priceDates;
    const historicalPeriodEnds = parseNullableStringArray(entry.historicalPeriodEnds, "method.historicalPeriodEnds");
    if (!historicalPeriodEnds.ok) return historicalPeriodEnds;
    if (!(entry.lookAheadSafe === null || typeof entry.lookAheadSafe === "boolean")) {
      return malformed("method.lookAheadSafe is not a boolean or null.");
    }
    if (!isNullableString(entry.unavailableReason)) return malformed("method.unavailableReason is not a string or null.");
    methods.push(entry as FairValueMethodEvidence);
  }
  return { ok: true, value: methods };
}

function parseAssumptions(value: unknown): Parsed<FairValueAssumptions> {
  if (!isRecord(value)) return malformed("assumptions_json is not an object.");
  if (typeof value.modelVersion !== "string") return malformed("assumptions.modelVersion is not a string.");
  const researchProfile = parseClosed(value.researchProfile, RESEARCH_PROFILES, "assumptions.researchProfile");
  if (!researchProfile.ok) return researchProfile;
  if (value.modelDefaultsUsed !== false) return unknownEnum("assumptions.modelDefaultsUsed", "false");
  if (value.yamlScoreBandsUsed !== false) return unknownEnum("assumptions.yamlScoreBandsUsed", "false");
  const peerGroupType = parseNullableClosed(value.peerGroupType, PEER_GROUP_TYPES, "assumptions.peerGroupType");
  if (!peerGroupType.ok) return peerGroupType;
  if (!isNullableString(value.peerSelectionPath)) return malformed("assumptions.peerSelectionPath is not a string or null.");
  const peerEligibleCount = parseNullableNumber(value.peerEligibleCount, "assumptions.peerEligibleCount");
  if (!peerEligibleCount.ok) return peerEligibleCount;
  if (!isNullableString(value.peerUnavailableReason)) return malformed("assumptions.peerUnavailableReason is not a string or null.");
  if (typeof value.historicalPointCount !== "number" || !Number.isFinite(value.historicalPointCount)) {
    return malformed("assumptions.historicalPointCount is not a finite number.");
  }
  if (typeof value.lookAheadSafe !== "boolean") return malformed("assumptions.lookAheadSafe is not a boolean.");
  const historicalValuationStatus = parseClosed(
    value.historicalValuationStatus,
    HISTORICAL_VALUATION_STATUSES,
    "assumptions.historicalValuationStatus",
  );
  if (!historicalValuationStatus.ok) return historicalValuationStatus;
  if (!isNullableString(value.historicalLimitation)) return malformed("assumptions.historicalLimitation is not a string or null.");
  const freshness = parseClosed(value.freshness, FRESHNESS_BANDS, "assumptions.freshness");
  if (!freshness.ok) return freshness;
  if (!isNullableString(value.freshnessObservationDate)) {
    return malformed("assumptions.freshnessObservationDate is not a string or null.");
  }
  const freshnessAgeMonths = parseNullableNumber(value.freshnessAgeMonths, "assumptions.freshnessAgeMonths");
  if (!freshnessAgeMonths.ok) return freshnessAgeMonths;
  if (!isNullableString(value.currentPriceDate)) return malformed("assumptions.currentPriceDate is not a string or null.");
  if (!isNullableString(value.fundamentalsPeriodEnd)) {
    return malformed("assumptions.fundamentalsPeriodEnd is not a string or null.");
  }
  if (value.excludedApproaches !== undefined && typeof value.excludedApproaches !== "string") {
    return malformed("assumptions.excludedApproaches is not a string.");
  }
  return { ok: true, value: value as FairValueAssumptions };
}

function parseQuality(value: unknown): Parsed<FairValueQuality> {
  if (!isRecord(value)) return malformed("quality_json is not an object.");
  const status = parseClosed(value.status, FAIR_VALUE_QUALITY_STATUSES, "quality.status");
  if (!status.ok) return status;
  const baseUse = parseClosed(value.baseUse, FAIR_VALUE_BASE_USES, "quality.baseUse");
  if (!baseUse.ok) return baseUse;
  if (!Array.isArray(value.methods)) return malformed("quality.methods is not an array.");
  for (const entry of value.methods) {
    if (!isRecord(entry)) return malformed("A quality method is not an object.");
    const id = parseClosed(entry.id, FAIR_VALUE_METHOD_IDS, "quality.method.id");
    if (!id.ok) return id;
    const state = parseClosed(entry.state, FAIR_VALUE_METHOD_QUALITY_STATES, "quality.method.state");
    if (!state.ok) return state;
    const flags = parseFindings(entry.flags, FAIR_VALUE_QUALITY_FLAG_CODES, "quality.method.flags");
    if (!flags.ok) return flags;
    const notes = parseFindings(entry.notes, FAIR_VALUE_QUALITY_NOTE_CODES, "quality.method.notes");
    if (!notes.ok) return notes;
  }
  const notes = parseFindings(value.notes, FAIR_VALUE_QUALITY_NOTE_CODES, "quality.notes");
  if (!notes.ok) return notes;
  if (!isNullableString(value.historicalLimitation)) {
    return malformed("quality.historicalLimitation is not a string or null.");
  }
  return { ok: true, value: value as FairValueQuality };
}

function parseFindings(
  value: unknown,
  codes: readonly string[],
  field: string,
): Parsed<unknown> {
  if (!Array.isArray(value)) return malformed(`${field} is not an array.`);
  for (const entry of value) {
    if (!isRecord(entry)) return malformed(`${field} entry is not an object.`);
    const code = parseClosed(entry.code, codes, `${field}.code`);
    if (!code.ok) return code;
    if (typeof entry.text !== "string") return malformed(`${field}.text is not a string.`);
  }
  return { ok: true, value };
}

function parseClosed<T extends string>(value: unknown, allowed: readonly T[], field: string): Parsed<T> {
  if (isOneOf(value, allowed)) return { ok: true, value };
  if (typeof value !== "string") return malformed(`${field} is not a string.`);
  return unknownEnum(field, allowed.join(", "));
}

function parseNullableClosed<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): Parsed<T | null> {
  if (value === null) return { ok: true, value: null };
  return parseClosed(value, allowed, field);
}

function parseNullableNumber(value: unknown, field: string): Parsed<number | null> {
  if (value == null) return { ok: true, value: null };
  if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
  return malformed(`${field} is not a finite number or null.`);
}

function parseNullableStringArray(value: unknown, field: string): Parsed<string[] | null> {
  if (value === null) return { ok: true, value: null };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return malformed(`${field} is not an array of strings or null.`);
  }
  return { ok: true, value: value as string[] };
}

function unreadable(id: number, code: FairValueRunReadCode, message: string): FairValueRunRead {
  return { ok: false, id, code, message };
}

function malformed(message: string): Parsed<never> {
  return { ok: false, code: "MALFORMED_JSON", message };
}

function unknownEnum(field: string, allowed: string): Parsed<never> {
  return { ok: false, code: "UNKNOWN_ENUM", message: `${field} is outside the closed set: ${allowed}.` };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
