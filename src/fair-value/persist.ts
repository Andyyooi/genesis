import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getSqlite } from "@/db/client";
import type { FairValueQuality } from "@/fair-value/quality";
import type { FairValueResult } from "@/fair-value/types";
import { isSnapshotReadOnly } from "@/lib/data-mode";

/** Persisted quality-gate generation. The assessor does not carry this identifier. */
export const FAIR_VALUE_QUALITY_VERSION = "fair-value-quality-v1";

export type FairValueRunWrite = {
  id: number;
  inserted: boolean;
};

export type FairValueRunInsert = {
  instrumentId: number;
  result: FairValueResult;
  quality: FairValueQuality;
  calculatedAt: string;
};

export type FairValueRunBatchRow = {
  ticker: string;
  instrumentId: number;
  result: FairValueResult;
  quality: FairValueQuality;
  calculatedAt?: string;
};

export type FairValueRunBatchResult = {
  inserted: number;
  unchanged: number;
  failed: { ticker: string; message: string }[];
};

type ObservationRow = {
  instrumentId: number;
  ticker: string;
  researchProfile: FairValueResult["researchProfile"];
  modelVersion: string;
  qualityVersion: string;
  valuationDate: string | null;
  fundamentalsPeriodEnd: string | null;
  currentPrice: number | null;
  fairValueLow: number | null;
  fairValueBase: number | null;
  fairValueHigh: number | null;
  differenceVsPrice: number | null;
  confidence: FairValueResult["confidence"];
  methodsJson: string;
  assumptionsJson: string;
  unavailableReason: string | null;
  calculatedAt: string;
  qualityStatus: string;
  baseUse: string;
  qualityJson: string;
  observationKey: string;
};

/**
 * Stable identity of one Fair Value observation.
 * Excludes the row id and calculated_at so a retry does not look like a new snapshot.
 */
export function fairValueObservationKey(args: {
  instrumentId: number;
  result: FairValueResult;
  quality: FairValueQuality;
}): string {
  const { result, quality } = args;
  const payload = {
    instrumentId: args.instrumentId,
    ticker: result.ticker,
    researchProfile: result.researchProfile,
    modelVersion: result.modelVersion,
    qualityVersion: FAIR_VALUE_QUALITY_VERSION,
    valuationDate: result.valuationDate,
    fundamentalsPeriodEnd: result.fundamentalsPeriodEnd,
    currentPrice: result.currentPrice,
    fairValueLow: result.fairValueLow,
    fairValueBase: result.fairValueBase,
    fairValueHigh: result.fairValueHigh,
    differenceVsPrice: result.differenceVsPrice,
    confidence: result.confidence,
    methods: result.methods,
    assumptions: result.assumptions,
    unavailableReason: result.unavailableReason,
    quality,
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** Append one observation, or return the existing row when the observation key already exists. */
export function insertFairValueRun(sqlite: Database.Database, row: FairValueRunInsert): FairValueRunWrite {
  const stored = observationRow(row);
  const findExisting = sqlite.prepare(
    `SELECT id FROM fair_value_runs
     WHERE instrument_id = ? AND model_version = ? AND quality_version = ? AND observation_key = ?`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO fair_value_runs (
      instrument_id, ticker, research_profile, model_version, valuation_date,
      fundamentals_period_end, current_price, fair_value_low, fair_value_base,
      fair_value_high, difference_vs_price, confidence, methods_json,
      assumptions_json, unavailable_reason, calculated_at,
      quality_status, base_use, quality_version, quality_json, observation_key
    ) VALUES (
      @instrumentId, @ticker, @researchProfile, @modelVersion, @valuationDate,
      @fundamentalsPeriodEnd, @currentPrice, @fairValueLow, @fairValueBase,
      @fairValueHigh, @differenceVsPrice, @confidence, @methodsJson,
      @assumptionsJson, @unavailableReason, @calculatedAt,
      @qualityStatus, @baseUse, @qualityVersion, @qualityJson, @observationKey
    )`,
  );
  const write = sqlite.transaction(() => {
    const existing = findExisting.get(
      stored.instrumentId,
      stored.modelVersion,
      stored.qualityVersion,
      stored.observationKey,
    ) as { id: number } | undefined;
    if (existing) return { id: existing.id, inserted: false };
    try {
      const info = insert.run(stored);
      return { id: Number(info.lastInsertRowid), inserted: true };
    } catch (error) {
      if (!isUniqueObservationConflict(error)) throw error;
      const raced = findExisting.get(
        stored.instrumentId,
        stored.modelVersion,
        stored.qualityVersion,
        stored.observationKey,
      ) as { id: number } | undefined;
      if (!raced) throw error;
      return { id: raced.id, inserted: false };
    }
  });
  return write.immediate();
}

/** Local writable database only. Snapshot / Vercel opens do not insert. */
export function persistFairValueRun(args: {
  instrumentId: number;
  result: FairValueResult;
  quality: FairValueQuality;
  calculatedAt?: string;
}): FairValueRunWrite | null {
  if (isSnapshotReadOnly()) return null;
  return insertFairValueRun(getSqlite(), {
    instrumentId: args.instrumentId,
    result: args.result,
    quality: args.quality,
    calculatedAt: args.calculatedAt ?? new Date().toISOString(),
  });
}

/**
 * Persist already-computed rows one ticker at a time.
 * Does not calculate, assess, load peers, refresh, or score.
 * A read-only snapshot returns null instead of a per-ticker failure list.
 */
export function persistFairValueRuns(rows: readonly FairValueRunBatchRow[]): FairValueRunBatchResult | null {
  if (isSnapshotReadOnly()) return null;
  const summary: FairValueRunBatchResult = { inserted: 0, unchanged: 0, failed: [] };
  for (const row of rows) {
    try {
      const saved = persistFairValueRun(row);
      if (saved == null) return null;
      if (saved.inserted) summary.inserted += 1;
      else summary.unchanged += 1;
    } catch (error) {
      summary.failed.push({
        ticker: row.ticker,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summary;
}

function observationRow(row: FairValueRunInsert): ObservationRow {
  const { result, quality } = row;
  assertPersistable(result, quality);
  return {
    instrumentId: row.instrumentId,
    ticker: result.ticker,
    researchProfile: result.researchProfile,
    modelVersion: result.modelVersion,
    qualityVersion: FAIR_VALUE_QUALITY_VERSION,
    valuationDate: result.valuationDate,
    fundamentalsPeriodEnd: result.fundamentalsPeriodEnd,
    currentPrice: result.currentPrice,
    fairValueLow: result.fairValueLow,
    fairValueBase: result.fairValueBase,
    fairValueHigh: result.fairValueHigh,
    differenceVsPrice: result.differenceVsPrice,
    confidence: result.confidence,
    methodsJson: JSON.stringify(result.methods),
    assumptionsJson: JSON.stringify(result.assumptions),
    unavailableReason: result.unavailableReason,
    calculatedAt: row.calculatedAt,
    qualityStatus: quality.status,
    baseUse: quality.baseUse,
    qualityJson: JSON.stringify(quality),
    observationKey: fairValueObservationKey(row),
  };
}

function assertPersistable(result: FairValueResult, quality: FairValueQuality) {
  const serialized = JSON.parse(JSON.stringify(quality)) as FairValueQuality;
  if (serialized.status !== quality.status || serialized.baseUse !== quality.baseUse) {
    throw new Error("Fair Value quality status does not match the serialized quality object.");
  }
  if (quality.baseUse === "NO_POINT") {
    if (result.fairValueBase !== null) {
      throw new Error("NO_POINT Fair Value persistence requires a null calculator base.");
    }
    return;
  }
  if (
    quality.baseUse === "POINT_OK" ||
    quality.baseUse === "POINT_WITH_CAUTION" ||
    quality.baseUse === "POINT_WITHHELD"
  ) {
    if (result.fairValueBase == null || !Number.isFinite(result.fairValueBase)) {
      throw new Error("This Fair Value base use requires the original calculator base.");
    }
    return;
  }
  throw new Error(`Unknown Fair Value base use: ${String(quality.baseUse)}`);
}

function isUniqueObservationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return false;
  if (code !== "SQLITE_CONSTRAINT_UNIQUE" && code !== "SQLITE_CONSTRAINT") return false;
  return error.message.includes("UNIQUE");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      sorted[key] = canonicalize(child);
    }
    return sorted;
  }
  return value;
}
