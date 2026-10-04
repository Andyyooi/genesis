import type Database from "better-sqlite3";
import { getSqlite } from "@/db/client";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import type { FairValueResult } from "@/fair-value/types";

export type FairValueRunInsert = {
  instrumentId: number;
  result: FairValueResult;
  calculatedAt: string;
};

/** Append one audit row. Does not update or replace older rows. */
export function insertFairValueRun(sqlite: Database.Database, row: FairValueRunInsert): number {
  const { result } = row;
  const info = sqlite
    .prepare(
      `INSERT INTO fair_value_runs (
        instrument_id, ticker, research_profile, model_version, valuation_date,
        fundamentals_period_end, current_price, fair_value_low, fair_value_base,
        fair_value_high, difference_vs_price, confidence, methods_json,
        assumptions_json, unavailable_reason, calculated_at
      ) VALUES (
        @instrumentId, @ticker, @researchProfile, @modelVersion, @valuationDate,
        @fundamentalsPeriodEnd, @currentPrice, @fairValueLow, @fairValueBase,
        @fairValueHigh, @differenceVsPrice, @confidence, @methodsJson,
        @assumptionsJson, @unavailableReason, @calculatedAt
      )`,
    )
    .run({
      instrumentId: row.instrumentId,
      ticker: result.ticker,
      researchProfile: result.researchProfile,
      modelVersion: result.modelVersion,
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
    });
  return Number(info.lastInsertRowid);
}

/** Local writable database only. Snapshot / Vercel opens do not insert. */
export function persistFairValueRun(args: {
  instrumentId: number;
  result: FairValueResult;
  calculatedAt?: string;
}): number | null {
  if (isSnapshotReadOnly()) return null;
  return insertFairValueRun(getSqlite(), {
    instrumentId: args.instrumentId,
    result: args.result,
    calculatedAt: args.calculatedAt ?? new Date().toISOString(),
  });
}
