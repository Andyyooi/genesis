import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getDb, getSqlite, migrateSqliteSchema } from "@/db/client";
import {
  FAIR_VALUE_QUALITY_VERSION,
  fairValueObservationKey,
  insertFairValueRun,
  persistFairValueRun,
  persistFairValueRuns,
} from "@/fair-value/persist";
import type { FairValueQuality } from "@/fair-value/quality";
import type { FairValueAssumptions, FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";

const PERIOD_END_LIMITATION =
  "Period-end price vs that period’s earnings, filing date unknown. This is not look-ahead-safe point-in-time P/E.";

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
    methods: [
      { id: "earnings_peer_pe", state: "CLEAR", flags: [], notes: [] },
      { id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] },
    ],
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

function reverseKeys<T extends Record<string, unknown>>(value: T): T {
  const reversed = {} as T;
  for (const key of Object.keys(value).reverse()) {
    reversed[key as keyof T] = value[key as keyof T];
  }
  return reversed;
}

describe("fair value observation key", () => {
  it("is stable for the same logical payload regardless of object key order", () => {
    const built = result({
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
    const reordered = result({
      ...built,
      assumptions: reverseKeys(built.assumptions),
      methods: [...built.methods].reverse().map((row) => reverseKeys(row)),
    });
    reordered.methods.reverse();
    const labeled = quality();
    const key = fairValueObservationKey({ instrumentId: 7, result: built, quality: labeled });
    expect(key).toBe(fairValueObservationKey({ instrumentId: 7, result: reordered, quality: reverseKeys(labeled) }));
    expect(key).toHaveLength(64);
  });

  it("changes when a meaningful value changes and ignores calculatedAt", () => {
    const built = result({
      fairValueBase: 4.03,
      methods: [method({ id: "book_peer_pb", label: "Book", methodValue: 4.03, currentInputName: "book_value_per_share" })],
    });
    const labeled = quality({
      methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }],
    });
    const key = fairValueObservationKey({ instrumentId: 7, result: built, quality: labeled });
    expect(fairValueObservationKey({ instrumentId: 7, result: built, quality: labeled })).toBe(key);
    expect(
      fairValueObservationKey({
        instrumentId: 7,
        result: { ...built, fairValueBase: 9 },
        quality: labeled,
      }),
    ).not.toBe(key);
    const { sqlite, instrumentId } = memoryDb();
    const storedKey = fairValueObservationKey({ instrumentId, result: built, quality: labeled });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T01:00:00.000Z",
    });
    const rows = sqlite.prepare(`SELECT observation_key, calculated_at FROM fair_value_runs`).all() as {
      observation_key: string;
      calculated_at: string;
    }[];
    expect(rows).toEqual([{ observation_key: storedKey, calculated_at: "2026-10-08T00:00:00.000Z" }]);
    sqlite.close();
  });
});

describe("insertFairValueRun", () => {
  it("round-trips the result and quality without rewriting them", () => {
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
    const labeled = quality({ notes: [{ code: "SPREAD_AT_LEAST_2X", text: "The valuation methods differ by at least 2×." }] });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    const row = sqlite.prepare(`SELECT * FROM fair_value_runs`).get() as Record<string, unknown>;
    expect(JSON.parse(String(row.methods_json))).toEqual(built.methods);
    expect(JSON.parse(String(row.assumptions_json))).toEqual(built.assumptions);
    expect(JSON.parse(String(row.quality_json))).toEqual(labeled);
    expect(row.ticker).toBe(built.ticker);
    expect(row.research_profile).toBe(built.researchProfile);
    expect(row.model_version).toBe(built.modelVersion);
    expect(row.valuation_date).toBe(built.valuationDate);
    expect(row.fundamentals_period_end).toBe(built.fundamentalsPeriodEnd);
    expect(row.current_price).toBe(built.currentPrice);
    expect(row.fair_value_low).toBe(built.fairValueLow);
    expect(row.fair_value_base).toBe(built.fairValueBase);
    expect(row.fair_value_high).toBe(built.fairValueHigh);
    expect(row.difference_vs_price).toBe(built.differenceVsPrice);
    expect(row.confidence).toBe(built.confidence);
    expect(row.unavailable_reason).toBe(built.unavailableReason);
    expect(row.quality_status).toBe(labeled.status);
    expect(row.base_use).toBe(labeled.baseUse);
    expect(row.quality_version).toBe(FAIR_VALUE_QUALITY_VERSION);
    expect(String(row.assumptions_json)).not.toContain("POINT_OK");
    sqlite.close();
  });

  it("keeps the calculator base when the point is withheld", () => {
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
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    const row = sqlite
      .prepare(`SELECT fair_value_base, quality_status, base_use FROM fair_value_runs`)
      .get() as { fair_value_base: number; quality_status: string; base_use: string };
    expect(row.quality_status).toBe("FLAGGED");
    expect(row.base_use).toBe("POINT_WITHHELD");
    expect(row.fair_value_base).toBe(4.0345);
    sqlite.close();
  });

  it("returns the original row when the same observation is persisted again", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({ methods: [method({ id: "book_peer_pb", label: "Book", currentInputName: "book_value_per_share" })] });
    const labeled = quality({ methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }] });
    const first = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    const second = insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-09T00:00:00.000Z",
    });
    const rows = sqlite.prepare(`SELECT id, calculated_at FROM fair_value_runs`).all() as {
      id: number;
      calculated_at: string;
    }[];
    expect(first).toEqual({ id: 1, inserted: true });
    expect(second).toEqual({ id: 1, inserted: false });
    expect(rows).toEqual([{ id: 1, calculated_at: "2026-10-08T00:00:00.000Z" }]);
    sqlite.close();
  });

  it("appends a new row when the calculator base changes", () => {
    const { sqlite, instrumentId } = memoryDb();
    const labeled = quality({ methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }] });
    const first = result({
      fairValueBase: 4,
      methods: [method({ id: "book_peer_pb", label: "Book", methodValue: 4, currentInputName: "book_value_per_share" })],
    });
    const second = result({
      fairValueBase: 5,
      methods: [method({ id: "book_peer_pb", label: "Book", methodValue: 5, currentInputName: "book_value_per_share" })],
    });
    insertFairValueRun(sqlite, { instrumentId, result: first, quality: labeled, calculatedAt: "2026-10-08T00:00:00.000Z" });
    const saved = insertFairValueRun(sqlite, {
      instrumentId,
      result: second,
      quality: labeled,
      calculatedAt: "2026-10-09T00:00:00.000Z",
    });
    const rows = sqlite.prepare(`SELECT fair_value_base FROM fair_value_runs ORDER BY id`).all() as {
      fair_value_base: number;
    }[];
    expect(saved).toEqual({ id: 2, inserted: true });
    expect(rows.map((row) => row.fair_value_base)).toEqual([4, 5]);
    sqlite.close();
  });

  it("stores an unsupported profile with a null base", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({
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
    const labeled = quality({ status: "NO_VALUE", baseUse: "NO_POINT", methods: [], notes: [], historicalLimitation: null });
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    const row = sqlite.prepare(`SELECT * FROM fair_value_runs`).get() as Record<string, unknown>;
    expect(row.model_version).toBe("unsupported");
    expect(row.fair_value_base).toBeNull();
    expect(row.quality_status).toBe("NO_VALUE");
    expect(row.base_use).toBe("NO_POINT");
    expect(JSON.parse(String(row.methods_json))).toEqual([]);
    expect(JSON.parse(String(row.quality_json))).toEqual(labeled);
    sqlite.close();
  });

  it("stores a supported result that produced no method value", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({
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
    const labeled = quality({
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
    insertFairValueRun(sqlite, {
      instrumentId,
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    });
    const row = sqlite.prepare(`SELECT fair_value_base, quality_status, base_use, model_version FROM fair_value_runs`).get() as {
      fair_value_base: number | null;
      quality_status: string;
      base_use: string;
      model_version: string;
    };
    expect(row.model_version).toBe("general-relative-v1");
    expect(row.fair_value_base).toBeNull();
    expect(row.quality_status).toBe("NO_VALUE");
    expect(row.base_use).toBe("NO_POINT");
    sqlite.close();
  });

  it("rejects a withheld point whose calculator base was removed", () => {
    const { sqlite, instrumentId } = memoryDb();
    const built = result({
      fairValueBase: null,
      fairValueLow: null,
      fairValueHigh: null,
      differenceVsPrice: null,
      methods: [method({ id: "earnings_peer_pe", label: "Earnings", methodValue: 7.05, currentInput: 0.6 })],
    });
    expect(() =>
      insertFairValueRun(sqlite, {
        instrumentId,
        result: built,
        quality: quality({ status: "FLAGGED", baseUse: "POINT_WITHHELD" }),
        calculatedAt: "2026-10-08T00:00:00.000Z",
      }),
    ).toThrow(/calculator base/);
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number };
    expect(count.n).toBe(0);
    sqlite.close();
  });

  it("adds quality columns and the observation index to an older table", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE fair_value_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        research_profile TEXT NOT NULL,
        model_version TEXT NOT NULL,
        valuation_date TEXT,
        fundamentals_period_end TEXT,
        current_price REAL,
        fair_value_low REAL,
        fair_value_base REAL,
        fair_value_high REAL,
        difference_vs_price REAL,
        confidence TEXT NOT NULL,
        methods_json TEXT NOT NULL,
        assumptions_json TEXT NOT NULL,
        unavailable_reason TEXT,
        calculated_at TEXT NOT NULL
      );
    `);
    migrateSqliteSchema(sqlite);
    const cols = (sqlite.pragma("table_info(fair_value_runs)") as { name: string }[]).map((col) => col.name);
    expect(cols.slice(-5)).toEqual([
      "quality_status",
      "base_use",
      "quality_version",
      "quality_json",
      "observation_key",
    ]);
    const index = sqlite
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'fair_value_runs_observation'`)
      .get() as { sql: string };
    expect(index.sql.toLowerCase()).toContain("unique");
    expect(index.sql).toContain("instrument_id");
    expect(index.sql).toContain("observation_key");
    sqlite.close();
  });
});

describe("persistFairValueRun read-only and batch isolation", () => {
  let tempDir = "";
  const previousPath = process.env.BURSA_SQLITE_PATH;
  const previousReadonly = process.env.BURSA_SNAPSHOT_READONLY;

  afterEach(() => {
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
    if (previousPath === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = previousPath;
    if (previousReadonly === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
    else process.env.BURSA_SNAPSHOT_READONLY = previousReadonly;
  });

  it("returns null and writes nothing when the snapshot is read-only", () => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-fv-persist-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.BURSA_SNAPSHOT_READONLY;
    delete process.env.VERCEL;
    resetDb();
    getDb();
    const instrument = getSqlite()
      .prepare(
        `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
         VALUES ('HUMEIND', 'Hume', 'COMMON_STOCK', '2026-01-01', '2026-01-01')`,
      )
      .run();
    const built = result({
      methods: [method({ id: "book_peer_pb", label: "Book", currentInputName: "book_value_per_share" })],
    });
    const labeled = quality({ methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }] });
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    expect(
      persistFairValueRun({
        instrumentId: Number(instrument.lastInsertRowid),
        result: built,
        quality: labeled,
        calculatedAt: "2026-10-08T00:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      persistFairValueRuns([
        {
          ticker: "HUMEIND",
          instrumentId: Number(instrument.lastInsertRowid),
          result: built,
          quality: labeled,
          calculatedAt: "2026-10-08T00:00:00.000Z",
        },
      ]),
    ).toBeNull();
    const count = getSqlite().prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("keeps a successful ticker when a later foreign key fails", () => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-fv-persist-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.BURSA_SNAPSHOT_READONLY;
    delete process.env.VERCEL;
    resetDb();
    getDb();
    const instrument = getSqlite()
      .prepare(
        `INSERT INTO instruments (ticker, name, instrument_type, created_at, updated_at)
         VALUES ('HUMEIND', 'Hume', 'COMMON_STOCK', '2026-01-01', '2026-01-01')`,
      )
      .run();
    const built = result({
      methods: [method({ id: "book_peer_pb", label: "Book", currentInputName: "book_value_per_share" })],
    });
    const labeled = quality({ methods: [{ id: "book_peer_pb", state: "CLEAR", flags: [], notes: [] }] });
    const row = {
      ticker: "HUMEIND",
      instrumentId: Number(instrument.lastInsertRowid),
      result: built,
      quality: labeled,
      calculatedAt: "2026-10-08T00:00:00.000Z",
    };
    const summary = persistFairValueRuns([
      { ...row, ticker: "MISSING", instrumentId: 999_999 },
      row,
      { ...row, calculatedAt: "2026-10-09T00:00:00.000Z" },
    ]);
    expect(summary).toEqual({
      inserted: 1,
      unchanged: 1,
      failed: [{ ticker: "MISSING", message: expect.stringMatching(/FOREIGN KEY/) }],
    });
    const count = getSqlite().prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("persist.ts source isolation", () => {
  it("does not calculate, assess, score, or fetch market data", () => {
    const source = readFileSync(new URL("../../src/fair-value/persist.ts", import.meta.url), "utf8");
    expect(source).not.toContain("calculateFairValue");
    expect(source).not.toContain("calculateGeneralFairValue");
    expect(source).not.toContain("calculateBankFairValue");
    expect(source).not.toContain("calculateReitFairValue");
    expect(source).not.toContain("assessFairValueQuality");
    expect(source).not.toContain("scoreTicker");
    expect(source).not.toContain("yahoo");
    expect(source).not.toContain("fetch(");
  });
});

function resetDb() {
  const g = globalThis as { sqlite?: { close: () => void } };
  try {
    g.sqlite?.close();
  } catch {
    /* The singleton may already be closed. */
  }
  delete g.sqlite;
}
