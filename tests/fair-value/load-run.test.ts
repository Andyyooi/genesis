import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateSqliteSchema } from "@/db/client";
import {
  loadFairValueRunById,
  loadFairValueRunHistory,
  loadLatestFairValueRun,
} from "@/fair-value/load-run";
import { FAIR_VALUE_QUALITY_VERSION, insertFairValueRun } from "@/fair-value/persist";
import type { FairValueQuality } from "@/fair-value/quality";
import type { FairValueAssumptions, FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";

const PERIOD_END_LIMITATION =
  "Period-end price vs that period’s earnings, filing date unknown. This is not look-ahead-safe point-in-time P/E.";
const CALCULATED_AT = "2026-10-08T00:00:00.000Z";

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

function result(patch: Partial<FairValueResult> & Pick<FairValueResult, "methods">): FairValueResult {
  const base = patch.fairValueBase === undefined ? 4.03 : patch.fairValueBase;
  const price = patch.currentPrice === undefined ? 2.65 : patch.currentPrice;
  return {
    ticker: "HUMEIND",
    researchProfile: "GENERAL",
    modelVersion: "general-relative-v1",
    valuationDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    currentPrice: price,
    fairValueLow: patch.fairValueLow === undefined ? 1.01 : patch.fairValueLow,
    fairValueBase: base,
    fairValueHigh: patch.fairValueHigh === undefined ? 7.05 : patch.fairValueHigh,
    differenceVsPrice: price != null && price > 0 && base != null ? (base - price) / price : null,
    confidence: "MEDIUM",
    assumptions: assumptions(),
    unavailableReason: null,
    ...patch,
  };
}

function quality(patch: Partial<FairValueQuality> = {}): FairValueQuality {
  return {
    status: "CLEAR",
    baseUse: "POINT_OK",
    methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }],
    notes: [],
    historicalLimitation: PERIOD_END_LIMITATION,
    ...patch,
  };
}

function memoryDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  migrateSqliteSchema(sqlite);
  const instrument = sqlite
    .prepare(
      `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
       VALUES ('HUMEIND', 'Hume', 'COMMON_STOCK', '2026-01-01', '2026-01-01')`,
    )
    .run();
  return { sqlite, instrumentId: Number(instrument.lastInsertRowid) };
}

function rowCount(sqlite: Database.Database): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number }).n;
}

function bookResult(base: number): FairValueResult {
  return result({
    fairValueBase: base,
    fairValueLow: base,
    fairValueHigh: base,
    methods: [
      method({
        id: "book_peer_pb",
        label: "Book",
        methodValue: base,
        currentInputName: "book_value_per_share",
        currentInput: 2,
      }),
    ],
  });
}

const query = {
  modelVersion: "general-relative-v1",
  qualityVersion: FAIR_VALUE_QUALITY_VERSION,
};

describe("loadFairValueRun", () => {
  it("round-trips stored columns and JSON payloads", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({
      currentPrice: 2.65,
      fairValueLow: 1.0143,
      fairValueBase: 4.0345,
      fairValueHigh: 7.0548,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 7.0548, currentInput: 0.6 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1.0143,
          currentInputName: "book_value_per_share",
          currentInput: 2,
        }),
      ],
    });
    const labeled = quality({
      methods: [
        { id: "earnings_peer_pe", state: "CLEAR", flags: [], notes: [] },
        { id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] },
      ],
      notes: [{ code: "SPREAD_AT_LEAST_2X", text: "The valuation methods differ by at least 2×." }],
    });
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: CALCULATED_AT,
    });
    const before = rowCount(sqlite);
    const loaded = loadFairValueRunById(sqlite, saved.id);
    expect(rowCount(sqlite)).toBe(before);
    expect(loaded?.ok).toBe(true);
    if (!loaded?.ok) return;
    expect(loaded.run.id).toBe(saved.id);
    expect(loaded.run.instrumentId).toBe(instrumentId);
    expect(loaded.run.calculatedAt).toBe(CALCULATED_AT);
    expect(loaded.run.qualityVersion).toBe(FAIR_VALUE_QUALITY_VERSION);
    expect(loaded.run.result).toEqual(built);
    expect(loaded.run.quality).toEqual(labeled);
    expect(loaded.run.observationKey.length).toBe(64);
    sqlite.close();
  });

  it("keeps the original base when the point is withheld", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({
      fairValueBase: 4.0345,
      methods: [
        method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 7.05, currentInput: 0.6 }),
        method({
          id: "book_peer_pb",
          label: "Book",
          methodValue: 1.01,
          currentInputName: "book_value_per_share",
          currentInput: 2,
        }),
      ],
    });
    const labeled = quality({
      status: "FLAGGED",
      baseUse: "POINT_WITHHELD",
      methods: [
        {
          id: "earnings_peer_pe",
          state: "FLAGGED",
          flags: [{ code: "EPS_YOY_DISCONTINUITY", text: "EPS moved." }],
          notes: [],
        },
      ],
    });
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: CALCULATED_AT,
    });
    const loaded = loadFairValueRunById(sqlite, saved.id);
    expect(loaded?.ok).toBe(true);
    if (!loaded?.ok) return;
    expect(loaded.run.quality.status).toBe("FLAGGED");
    expect(loaded.run.quality.baseUse).toBe("POINT_WITHHELD");
    expect(loaded.run.result.fairValueBase).toBe(4.0345);
    sqlite.close();
  });

  it("preserves unsupported and supported NO_VALUE observations", () => {
    const { sqlite, instrumentId } = memoryDb();
    const unsupported = result({
      ticker: "SCGM",
      researchProfile: "UNKNOWN",
      modelVersion: "unsupported",
      valuationDate: null,
      fundamentalsPeriodEnd: null,
      currentPrice: null,
      fairValueLow: null,
      fairValueBase: null,
      fairValueHigh: null,
      differenceVsPrice: null,
      confidence: "UNAVAILABLE",
      methods: [],
      assumptions: assumptions({
        modelVersion: "unsupported",
        researchProfile: "UNKNOWN",
        historicalLimitation: null,
        historicalValuationStatus: "UNAVAILABLE",
        fundamentalsPeriodEnd: null,
        currentPriceDate: null,
      }),
      unavailableReason: "No Fair Value model exists for research profile UNKNOWN.",
    });
    const unsupportedQuality = quality({
      status: "NO_VALUE",
      baseUse: "NO_POINT",
      methods: [],
      historicalLimitation: null,
    });
    const supported = result({
      fairValueLow: null,
      fairValueBase: null,
      fairValueHigh: null,
      differenceVsPrice: null,
      confidence: "UNAVAILABLE",
      methods: [
        method({
          id: "earnings_peer_pe",
          label: "Earnings",
          available: false,
          methodValue: null,
          currentInput: null,
          unavailableReason: "No positive EPS.",
        }),
      ],
      unavailableReason: "No Fair Value method produced a value.",
    });
    const supportedQuality = quality({
      status: "NO_VALUE",
      baseUse: "NO_POINT",
      methods: [
        {
          id: "earnings_peer_pe",
          state: "ABSENT",
          flags: [],
          notes: [{ code: "EPS_EXPLICIT_ZERO_PAT_POSITIVE", text: "Stored EPS is zero while PAT is positive." }],
        },
      ],
    });
    const unsupportedId = insertFairValueRun(sqlite, {
      instrumentId,
      result: unsupported,
      quality: unsupportedQuality,
      calculatedAt: CALCULATED_AT,
    }).id;
    const supportedId = insertFairValueRun(sqlite, {
      instrumentId,
      result: supported,
      quality: supportedQuality,
      calculatedAt: "2026-10-08T01:00:00.000Z",
    }).id;
    const unsupportedLoaded = loadFairValueRunById(sqlite, unsupportedId);
    const supportedLoaded = loadFairValueRunById(sqlite, supportedId);
    expect(unsupportedLoaded?.ok && unsupportedLoaded.run.result).toEqual(unsupported);
    expect(unsupportedLoaded?.ok && unsupportedLoaded.run.quality).toEqual(unsupportedQuality);
    expect(supportedLoaded?.ok && supportedLoaded.run.result.fairValueBase).toBeNull();
    expect(supportedLoaded?.ok && supportedLoaded.run.result.unavailableReason).toBe(
      "No Fair Value method produced a value.",
    );
    expect(supportedLoaded?.ok && supportedLoaded.run.quality.status).toBe("NO_VALUE");
    expect(supportedLoaded?.ok && supportedLoaded.run.quality.baseUse).toBe("NO_POINT");
    expect(supportedLoaded?.ok && supportedLoaded.run.result.methods).toEqual(supported.methods);
    sqlite.close();
  });

  it("reads one row after an idempotent insert", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = bookResult(4);
    const labeled = quality();
    const first = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: CALCULATED_AT,
    });
    const second = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-09T00:00:00.000Z",
    });
    const before = rowCount(sqlite);
    const latest = loadLatestFairValueRun(sqlite, { instrumentId, ...query });
    const history = loadFairValueRunHistory(sqlite, { instrumentId, ...query });
    expect(second).toEqual({ id: first.id, inserted: false });
    expect(rowCount(sqlite)).toBe(before);
    expect(history).toHaveLength(1);
    expect(latest?.ok && latest.run.calculatedAt).toBe(CALCULATED_AT);
    expect(latest?.ok && latest.run.result.fairValueBase).toBe(4);
    sqlite.close();
  });

  it("orders changed observations newest first and isolates model and quality versions", () => {
    const { sqlite, instrumentId } = memoryDb();
    insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(4),
      quality: quality(),
      calculatedAt: CALCULATED_AT,
    });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(5),
      quality: quality(),
      calculatedAt: "2026-10-09T00:00:00.000Z",
    });
    const bank = bookResult(9);
    bank.modelVersion = "bank-relative-v1";
    bank.assumptions = assumptions({ modelVersion: "bank-relative-v1" });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: bank,
      quality: quality(),
      calculatedAt: "2026-10-10T00:00:00.000Z",
    });
    const ordered = loadFairValueRunHistory(sqlite, { instrumentId, ...query });
    expect(ordered.map((row) => row.ok && row.run.result.fairValueBase)).toEqual([5, 4]);

    const newerGeneral = sqlite.prepare(`SELECT MAX(id) AS id FROM fair_value_runs WHERE model_version = ?`).get(
      "general-relative-v1",
    ) as { id: number };
    sqlite.prepare(`UPDATE fair_value_runs SET quality_version = ? WHERE id = ?`).run("fair-value-quality-v2", newerGeneral.id);

    const before = rowCount(sqlite);
    const history = loadFairValueRunHistory(sqlite, { instrumentId, ...query, limit: 1 });
    const latest = loadLatestFairValueRun(sqlite, { instrumentId, ...query });
    const bankLatest = loadLatestFairValueRun(sqlite, {
      instrumentId,
      modelVersion: "bank-relative-v1",
      qualityVersion: FAIR_VALUE_QUALITY_VERSION,
    });
    const future = loadLatestFairValueRun(sqlite, {
      instrumentId,
      modelVersion: "general-relative-v1",
      qualityVersion: "fair-value-quality-v2",
    });
    expect(rowCount(sqlite)).toBe(before);
    expect(history).toHaveLength(1);
    expect(history[0]?.ok && history[0].run.result.fairValueBase).toBe(4);
    expect(latest?.ok && latest.run.result.fairValueBase).toBe(4);
    expect(bankLatest?.ok && bankLatest.run.result.modelVersion).toBe("bank-relative-v1");
    expect(bankLatest?.ok && bankLatest.run.result.fairValueBase).toBe(9);
    expect(future?.ok).toBe(false);
    if (future && !future.ok) expect(future.code).toBe("UNKNOWN_QUALITY_VERSION");
    sqlite.close();
  });

  it("does not replace an unreadable newest row with an older one", () => {
    const { sqlite, instrumentId } = memoryDb();
    insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(4),
      quality: quality(),
      calculatedAt: CALCULATED_AT,
    });
    const newer = insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(5),
      quality: quality(),
      calculatedAt: "2026-10-09T00:00:00.000Z",
    });
    sqlite.prepare(`UPDATE fair_value_runs SET methods_json = ? WHERE id = ?`).run("{", newer.id);
    const latest = loadLatestFairValueRun(sqlite, { instrumentId, ...query });
    const history = loadFairValueRunHistory(sqlite, { instrumentId, ...query });
    expect(latest).toMatchObject({ ok: false, id: newer.id, code: "MALFORMED_JSON" });
    expect(history[0]).toMatchObject({ ok: false, id: newer.id, code: "MALFORMED_JSON" });
    expect(history[1]?.ok && history[1].run.result.fairValueBase).toBe(4);
    sqlite.close();
  });

  it("reports malformed JSON and wrong JSON shapes", () => {
    const { sqlite, instrumentId } = memoryDb();
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(4),
      quality: quality(),
      calculatedAt: CALCULATED_AT,
    });
    sqlite.prepare(`UPDATE fair_value_runs SET methods_json = ? WHERE id = ?`).run("{", saved.id);
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "MALFORMED_JSON" });
    sqlite.prepare(`UPDATE fair_value_runs SET methods_json = ? WHERE id = ?`).run("{}", saved.id);
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "MALFORMED_JSON" });
    sqlite.prepare(`UPDATE fair_value_runs SET methods_json = ?, quality_json = ? WHERE id = ?`).run("[]", "[]", saved.id);
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "MALFORMED_JSON" });
    sqlite.close();
  });

  it("reports null required fields and unknown closed-set values", () => {
    const { sqlite, instrumentId } = memoryDb();
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(4),
      quality: quality(),
      calculatedAt: CALCULATED_AT,
    });
    sqlite.prepare(`UPDATE fair_value_runs SET quality_json = NULL WHERE id = ?`).run(saved.id);
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "INCOMPLETE_ROW" });

    sqlite.prepare(`UPDATE fair_value_runs SET quality_json = ?, confidence = ? WHERE id = ?`).run(
      JSON.stringify(quality()),
      "SUPER",
      saved.id,
    );
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "UNKNOWN_ENUM" });

    const badQuality = quality({
      methods: [
        {
          id: "book_peer_pb",
          state: "CLEAR",
          flags: [{ code: "NOT_A_FLAG" as "EPS_YOY_DISCONTINUITY", text: "no" }],
          notes: [],
        },
      ],
    });
    sqlite.prepare(`UPDATE fair_value_runs SET confidence = ?, quality_json = ? WHERE id = ?`).run(
      "MEDIUM",
      JSON.stringify(badQuality),
      saved.id,
    );
    expect(loadFairValueRunById(sqlite, saved.id)).toMatchObject({ ok: false, code: "UNKNOWN_ENUM" });
    expect(loadFairValueRunById(sqlite, 999)).toBeNull();
    sqlite.close();
  });

  it("reports column mismatches for assumption fields that exist on the stored object", () => {
    const { sqlite, instrumentId } = memoryDb();
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: bookResult(4),
      quality: quality(),
      calculatedAt: CALCULATED_AT,
    });
    sqlite.prepare(`UPDATE fair_value_runs SET quality_status = ? WHERE id = ?`).run("FLAGGED", saved.id);
    expect(loadFairValueRunById(sqlite, saved.id)?.ok === false && loadFairValueRunById(sqlite, saved.id)).toMatchObject({
      code: "COLUMN_MISMATCH",
    });

    const stored = sqlite.prepare(`SELECT assumptions_json FROM fair_value_runs WHERE id = ?`).get(saved.id) as {
      assumptions_json: string;
    };
    const parsed = JSON.parse(stored.assumptions_json) as FairValueAssumptions;
    sqlite
      .prepare(`UPDATE fair_value_runs SET quality_status = ?, assumptions_json = ? WHERE id = ?`)
      .run("CLEAR", JSON.stringify({ ...parsed, modelVersion: "bank-relative-v1" }), saved.id);
    const modelMismatch = loadFairValueRunById(sqlite, saved.id);
    expect(modelMismatch?.ok).toBe(false);
    if (modelMismatch && !modelMismatch.ok) expect(modelMismatch.message).toContain("assumptions.modelVersion");

    sqlite
      .prepare(`UPDATE fair_value_runs SET assumptions_json = ? WHERE id = ?`)
      .run(JSON.stringify({ ...parsed, researchProfile: "BANK" }), saved.id);
    const profileMismatch = loadFairValueRunById(sqlite, saved.id);
    expect(profileMismatch?.ok).toBe(false);
    if (profileMismatch && !profileMismatch.ok) expect(profileMismatch.message).toContain("assumptions.researchProfile");

    sqlite
      .prepare(`UPDATE fair_value_runs SET assumptions_json = ? WHERE id = ?`)
      .run(JSON.stringify({ ...parsed, fundamentalsPeriodEnd: "2024-12-31" }), saved.id);
    const periodMismatch = loadFairValueRunById(sqlite, saved.id);
    expect(periodMismatch?.ok).toBe(false);
    if (periodMismatch && !periodMismatch.ok) {
      expect(periodMismatch.message).toContain("assumptions.fundamentalsPeriodEnd");
    }
    sqlite.close();
  });

  it("throws for a history limit outside 1 to 50", () => {
    const { sqlite, instrumentId } = memoryDb();
    expect(() => loadFairValueRunHistory(sqlite, { instrumentId, ...query, limit: 0 })).toThrow(/1 to 50/);
    expect(() => loadFairValueRunHistory(sqlite, { instrumentId, ...query, limit: 51 })).toThrow(/1 to 50/);
    expect(() => loadFairValueRunHistory(sqlite, { instrumentId, ...query, limit: 1.5 })).toThrow(/1 to 50/);
    expect(loadFairValueRunHistory(sqlite, { instrumentId, ...query })).toEqual([]);
    expect(loadFairValueRunHistory(sqlite, { instrumentId, ...query, limit: 50 })).toEqual([]);
    sqlite.close();
  });
});

describe("load-run source isolation", () => {
  it("does not calculate, assess, hash, persist, or open the application database", () => {
    const source = readFileSync(new URL("../../src/fair-value/load-run.ts", import.meta.url), "utf8");
    expect(source).not.toContain("calculateFairValue");
    expect(source).not.toContain("assessFairValueQuality");
    expect(source).not.toContain("scoreTicker");
    expect(source).not.toContain("yahoo");
    expect(source).not.toContain("getDb");
    expect(source).not.toContain("insertFairValueRun");
    expect(source).not.toContain("fairValueObservationKey");
    expect(source).not.toContain("createHash");
  });
});
