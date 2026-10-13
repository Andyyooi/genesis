import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, getSqlite } from "@/db/client";
import { fairValueRuns, instruments } from "@/db/schema";
import type { PricesImportReport } from "@/ingest/types";
import type { YahooFundamentalsReport } from "@/market/ingest-fundamentals-yahoo";
import type { FairValueResult } from "@/fair-value/types";
import type { FairValueQuality } from "@/fair-value/quality";
import { FAIR_VALUE_QUALITY_VERSION, persistFairValueRun } from "@/fair-value/persist";
import { runDailyRefresh } from "@/refresh/daily";
import { fairValueRefreshOutcome, refreshFairValueUniverse, type FairValueRefreshReport } from "@/refresh/fair-value";
import { resetRefreshAndResearchLockForTests, runRefreshAndResearch } from "@/refresh/on-demand";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
const AS_OF = "2026-10-08T00:00:00.000Z";
let tempDir = "";

function resetDb() {
  const g = globalThis as { sqlite?: { close: () => void } };
  try {
    g.sqlite?.close();
  } catch {
    /* The singleton may already be closed. */
  }
  delete g.sqlite;
}

function seed(ticker: string, industry: string, sector = "Industrial Products") {
  const now = AS_OF;
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: "0000",
      yahooTicker: `${ticker}.KL`,
      name: `${ticker} Test`,
      sector,
      industry,
      listingBoard: "MAIN",
      instrumentType: "COMMON_STOCK",
      researchProfile: null,
      pn17: false,
      currency: "MYR",
      shariahCompliant: null,
      watchlist: false,
      listingStatus: "listed",
      universeSource: "test",
      universeSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function valuedResult(ticker: string): FairValueResult {
  return {
    ticker,
    researchProfile: "GENERAL",
    modelVersion: "general-relative-v1",
    valuationDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    currentPrice: 2.65,
    fairValueLow: 1.01,
    fairValueBase: 4.03,
    fairValueHigh: 7.05,
    differenceVsPrice: (4.03 - 2.65) / 2.65,
    confidence: "MEDIUM",
    unavailableReason: null,
    assumptions: {
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
      historicalLimitation: "Period-end fixture.",
      freshness: "FRESH",
      freshnessObservationDate: "2025-12-31",
      freshnessAgeMonths: 9,
      currentPriceDate: "2026-09-25",
      fundamentalsPeriodEnd: "2025-12-31",
    },
    methods: [
      {
        id: "earnings_peer_pe",
        kind: "peer",
        label: "Peer P/E",
        available: true,
        methodValue: 4.03,
        formula: "fixture",
        currentInput: 0.5,
        currentInputName: "eps",
        medianMultiple: 8,
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
      },
    ],
  };
}

function qualityFor(ticker: string): FairValueQuality {
  if (ticker === "CAUTION") {
    return {
      status: "FLAGGED",
      baseUse: "POINT_WITH_CAUTION",
      methods: [],
      notes: [],
      historicalLimitation: null,
    };
  }
  if (ticker === "WITHHELD") {
    return {
      status: "FLAGGED",
      baseUse: "POINT_WITHHELD",
      methods: [],
      notes: [],
      historicalLimitation: null,
    };
  }
  return {
    status: "FLAGGED",
    baseUse: "POINT_OK",
    methods: [],
    notes: [],
    historicalLimitation: null,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "genesis-fv-refresh-"));
  process.env.BURSA_SQLITE_PATH = join(tempDir, "research.db");
  delete process.env.BURSA_SNAPSHOT_READONLY;
  resetDb();
});

afterEach(() => {
  delete process.env.BURSA_SNAPSHOT_READONLY;
  resetDb();
  if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
  else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("fair value daily refresh", () => {
  it("inserts one observation and leaves it unchanged on a repeat run", () => {
    seed("WIDGET", "Industrial Products");
    const first = refreshFairValueUniverse({ asOf: AS_OF });
    expect(first.inserted).toBe(1);
    expect(first.failed).toEqual([]);
    expect(first.noValue).toBe(1);
    const rows = getDb().select().from(fairValueRuns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.calculatedAt).toBe(AS_OF);
    expect(rows[0]!.fairValueBase).toBeNull();

    const second = refreshFairValueUniverse({ asOf: AS_OF });
    expect(second.inserted).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.valuedInserted).toBe(0);
    expect(second.valuedUnchanged).toBe(0);
    const replay = fairValueRefreshOutcome(second);
    expect(replay.status).toBe("NO_DATA");
    expect(replay.updatedCount).toBe(0);
    expect(replay.unavailableCount).toBe(1);
    expect(replay.errorSummary).toContain("did not produce a value");
    const again = getDb().select().from(fairValueRuns).all();
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe(rows[0]!.id);
    expect(again[0]!.calculatedAt).toBe(AS_OF);
  });

  it("stores unsupported and supported NO_VALUE observations without calling them valuations", () => {
    seed("INSURE", "Insurance", "Financial Services");
    seed("WIDGET", "Industrial Products");
    const report = refreshFairValueUniverse({ asOf: AS_OF });
    expect(report.failed).toEqual([]);
    expect(report.inserted).toBe(2);
    expect(report.unsupported).toBe(1);
    expect(report.noValue).toBe(2);
    const rows = getDb().select().from(fairValueRuns).all();
    expect(rows.map((row) => row.modelVersion).sort()).toEqual(["general-relative-v1", "unsupported"]);
    expect(rows.every((row) => row.fairValueBase == null)).toBe(true);
    expect(rows.every((row) => row.qualityStatus === "NO_VALUE" && row.baseUse === "NO_POINT")).toBe(true);
    const outcome = fairValueRefreshOutcome(report);
    expect(outcome.status).toBe("NO_DATA");
    expect(outcome.updatedCount).toBe(0);
    expect(outcome.unavailableCount).toBe(2);
    expect(outcome.errorSummary).toContain("No Fair Value model");
    expect(outcome.errorSummary).toContain("did not produce a value");
  });

  it("isolates a calculation failure from a successful ticker", () => {
    seed("GOOD", "Industrial Products");
    seed("BAD", "Industrial Products");
    const report = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => {
        if (input.ticker === "BAD") throw new Error("calc broke");
        return valuedResult(input.ticker);
      },
    });
    expect(report.inserted).toBe(1);
    expect(report.failed).toEqual([{ ticker: "BAD", stage: "calculation", message: "calc broke" }]);
    expect(getDb().select().from(fairValueRuns).all().map((row) => row.ticker)).toEqual(["GOOD"]);
    expect(fairValueRefreshOutcome(report).status).toBe("PARTIAL");
  });

  it("records quality assessment and persistence failures without rolling back the other ticker", () => {
    seed("GOOD", "Industrial Products");
    seed("ASSESS", "Industrial Products");
    const assessed = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => valuedResult(input.ticker),
      assess: () => {
        throw new Error("assess broke");
      },
    });
    expect(assessed.inserted).toBe(0);
    expect(assessed.failed.map((row) => row.stage)).toEqual(["quality_assessment", "quality_assessment"]);
    expect(getDb().select().from(fairValueRuns).all()).toHaveLength(0);

    seed("KEEP", "Industrial Products");
    const persisted = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => valuedResult(input.ticker),
      persist: (row) => {
        if (row.result.ticker === "ASSESS") throw new Error("write broke");
        return persistFairValueRun(row);
      },
    });
    expect(persisted.failed).toEqual([
      { ticker: "ASSESS", stage: "persistence", message: "write broke" },
    ]);
    expect(persisted.inserted).toBe(2);
    expect(getDb().select().from(fairValueRuns).all().map((row) => row.ticker).sort()).toEqual([
      "GOOD",
      "KEEP",
    ]);
    expect(fairValueRefreshOutcome(persisted).metadata.failureStage).toBe("persistence");
    expect(String(fairValueRefreshOutcome(persisted).errorSummary)).not.toContain("Yahoo");
  });

  it("stores flagged, caution, and withheld observations", () => {
    seed("FLAGGED", "Industrial Products");
    seed("CAUTION", "Industrial Products");
    seed("WITHHELD", "Industrial Products");
    const report = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => valuedResult(input.ticker),
      assess: (result) => qualityFor(result.ticker),
    });
    expect(report.failed).toEqual([]);
    expect(report.inserted).toBe(3);
    expect(report.flagged).toBe(3);
    expect(report.caution).toBe(1);
    expect(report.withheld).toBe(1);
    const bases = getDb().select().from(fairValueRuns).all();
    expect(bases).toHaveLength(3);
    expect(bases.every((row) => row.fairValueBase === 4.03)).toBe(true);
    expect(bases.map((row) => row.baseUse).sort()).toEqual([
      "POINT_OK",
      "POINT_WITHHELD",
      "POINT_WITH_CAUTION",
    ]);
    const outcome = fairValueRefreshOutcome(report);
    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.updatedCount).toBe(3);
    expect(outcome.unavailableCount).toBe(0);
  });

  it("reports a null persistence result as failure and keeps earlier rows", () => {
    seed("FIRST", "Industrial Products");
    seed("SECOND", "Industrial Products");
    const report = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => valuedResult(input.ticker),
      persist: (row) => (row.result.ticker === "SECOND" ? null : persistFairValueRun(row)),
    });
    const outcome = fairValueRefreshOutcome(report);
    expect(report.persistenceRefused).toBe(true);
    expect(report.inserted).toBe(1);
    expect(report.failed).toEqual([]);
    expect(outcome.status).toBe("PARTIAL");
    expect(outcome.metadata.failureStage).toBe("persistence");
    expect(outcome.errorSummary).toContain("persistence");
    expect(outcome.errorSummary).not.toContain("Yahoo");
    expect(getDb().select().from(fairValueRuns).all().map((row) => row.ticker)).toEqual(["FIRST"]);

    const refused = refreshFairValueUniverse({
      asOf: AS_OF,
      calculate: (input) => valuedResult(input.ticker),
      persist: () => null,
    });
    expect(fairValueRefreshOutcome(refused).status).toBe("SOURCE_FAILED");
  });

  it("treats a read-only snapshot as a persistence refusal and leaves the stock page disconnected", () => {
    seed("WIDGET", "Industrial Products");
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const report = refreshFairValueUniverse({ asOf: AS_OF });
    expect(report.persistenceRefused).toBe(true);
    expect(report.inserted).toBe(0);
    expect(fairValueRefreshOutcome(report).status).toBe("SOURCE_FAILED");
    expect(getSqlite().prepare("SELECT COUNT(*) AS n FROM fair_value_runs").get()).toEqual({ n: 0 });

    const page = readFileSync("src/app/stock/[ticker]/page.tsx", "utf8");
    expect(page).not.toContain("persistFairValueRun");
    expect(page).not.toContain("refresh/fair-value");
    expect(page).toContain("loadFairValueForPage");
    expect(readFileSync("src/fair-value/load-for-page.ts", "utf8")).not.toContain("persistFairValueRun");
  });

  it("does not let a Fair Value failure change the prices and fundamentals overall status", async () => {
    seed("WIDGET", "Industrial Products");
    const summary = await runDailyRefresh({
      now: () => new Date(AS_OF),
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: AS_OF,
          finishedAt: AS_OF,
          succeeded: ["WIDGET"],
          failed: [],
          barsUpserted: 1,
        }) satisfies PricesImportReport,
      importFundamentals: async () =>
        ({
          kind: "fundamentals-yahoo",
          startedAt: AS_OF,
          finishedAt: AS_OF,
          attempted: 1,
          upserted: 0,
          inserted: 0,
          filled: 0,
          unchanged: 1,
          skippedHadFilings: 0,
          skippedOtherSource: 0,
          instrumentsUpdated: 0,
          instrumentsUnchanged: 1,
          instrumentsSkippedFresh: 1,
          instrumentsFetched: 0,
          failed: [],
        }) satisfies YahooFundamentalsReport,
      rescore: () => ({ kind: "ok" }),
      persistFairValues: () => ({
        attempted: 1,
        inserted: 0,
        unchanged: 0,
        failed: [],
        unsupported: 0,
        noValue: 0,
        flagged: 0,
        caution: 0,
        withheld: 0,
        persistenceRefused: true,
      }),
    });
    expect(summary.overallStatus).toBe("SUCCESS");
    const fairValue = summary.datasets.find((row) => row.dataset === "fair_value")!;
    expect(fairValue.status).toBe("SOURCE_FAILED");
    expect(fairValue.metadata?.failureStage).toBe("persistence");
    expect(summary.notes.some((note) => note.includes("Fair Value dataset SOURCE_FAILED"))).toBe(true);
    expect(summary.datasets.map((row) => row.dataset)).toEqual([
      "prices",
      "fundamentals",
      "events",
      "news",
      "scores",
      "fair_value",
    ]);
  });

  it("persists unsupported and missing-input Fair Value through daily refresh", async () => {
    seed("INSURE", "Insurance", "Financial Services");
    seed("WIDGET", "Industrial Products");
    const deps = {
      now: () => new Date(AS_OF),
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: AS_OF,
          finishedAt: AS_OF,
          succeeded: ["INSURE", "WIDGET"],
          failed: [],
          barsUpserted: 1,
        }) satisfies PricesImportReport,
      importFundamentals: async () =>
        ({
          kind: "fundamentals-yahoo",
          startedAt: AS_OF,
          finishedAt: AS_OF,
          attempted: 2,
          upserted: 0,
          inserted: 0,
          filled: 0,
          unchanged: 2,
          skippedHadFilings: 0,
          skippedOtherSource: 0,
          instrumentsUpdated: 0,
          instrumentsUnchanged: 2,
          instrumentsSkippedFresh: 2,
          instrumentsFetched: 0,
          failed: [],
        }) satisfies YahooFundamentalsReport,
      rescore: () => ({ kind: "ok" }),
    };
    const first = await runDailyRefresh(deps);
    const fairValue = first.datasets.find((row) => row.dataset === "fair_value")!;
    expect(first.overallStatus).toBe("SUCCESS");
    expect(fairValue.status).toBe("NO_DATA");
    expect(fairValue.updatedCount).toBe(0);
    expect(fairValue.failedCount).toBe(0);
    expect(fairValue.unavailableCount).toBe(2);
    expect(fairValue.errorSummary).toContain("No Fair Value model");
    expect(fairValue.errorSummary).toContain("did not produce a value");
    expect(fairValue.metadata).toMatchObject({
      unsupported: 1,
      noValue: 2,
      flagged: 0,
      caution: 0,
      withheld: 0,
    });
    const stored = getDb().select().from(fairValueRuns).all();
    expect(stored).toHaveLength(2);
    const insure = stored.find((row) => row.ticker === "INSURE")!;
    const widget = stored.find((row) => row.ticker === "WIDGET")!;
    expect(insure.modelVersion).toBe("unsupported");
    expect(widget.modelVersion).toBe("general-relative-v1");
    for (const row of [insure, widget]) {
      expect(row.fairValueBase).toBeNull();
      expect(row.qualityStatus).toBe("NO_VALUE");
      expect(row.baseUse).toBe("NO_POINT");
      expect(row.qualityVersion).toBe(FAIR_VALUE_QUALITY_VERSION);
      expect(row.calculatedAt).toBe(AS_OF);
    }

    const second = await runDailyRefresh(deps);
    const replay = second.datasets.find((row) => row.dataset === "fair_value")!;
    expect(replay.status).toBe("NO_DATA");
    expect(replay.updatedCount).toBe(0);
    expect(replay.unchangedCount).toBe(0);
    expect(replay.unavailableCount).toBe(2);
    const again = getDb().select().from(fairValueRuns).all();
    expect(again.map((row) => row.id).sort()).toEqual(stored.map((row) => row.id).sort());
    expect(again.every((row) => row.calculatedAt === AS_OF)).toBe(true);
  });

  it("reports a produced value as success and a repeat as unchanged", () => {
    seed("GOOD", "Industrial Products");
    const clear: FairValueQuality = {
      status: "CLEAR",
      baseUse: "POINT_OK",
      methods: [],
      notes: [],
      historicalLimitation: null,
    };
    const run = () =>
      refreshFairValueUniverse({
        asOf: AS_OF,
        calculate: (input) => valuedResult(input.ticker),
        assess: () => clear,
      });
    const first = run();
    expect(first.valuedInserted).toBe(1);
    expect(first.noValue).toBe(0);
    expect(fairValueRefreshOutcome(first)).toMatchObject({
      status: "SUCCESS",
      updatedCount: 1,
      unchangedCount: 0,
      unavailableCount: 0,
      errorSummary: null,
    });
    const second = run();
    expect(second.inserted).toBe(0);
    expect(second.valuedUnchanged).toBe(1);
    expect(fairValueRefreshOutcome(second).status).toBe("UNCHANGED");
    expect(getDb().select().from(fairValueRuns).all()).toHaveLength(1);
  });

  it("uses the same Fair Value status for daily refresh and on-demand research", async () => {
    seed("WIDGET", "Industrial Products");
    const cases: Array<{ name: string; report: FairValueRefreshReport; status: string }> = [
      {
        name: "unsupported",
        status: "NO_DATA",
        report: outcomeReport({ inserted: 1, valuedInserted: 0, unsupported: 1, noValue: 1 }),
      },
      {
        name: "no value",
        status: "NO_DATA",
        report: outcomeReport({ inserted: 1, valuedInserted: 0, noValue: 1 }),
      },
      {
        name: "valued",
        status: "SUCCESS",
        report: outcomeReport({ inserted: 1, valuedInserted: 1 }),
      },
      {
        name: "valued replay",
        status: "UNCHANGED",
        report: outcomeReport({ unchanged: 1, valuedUnchanged: 1 }),
      },
    ];
    for (const item of cases) {
      expect(fairValueRefreshOutcome(item.report).status, item.name).toBe(item.status);
      const daily = await runDailyRefresh({
        now: () => new Date(AS_OF),
        importPrices: async () => priceDeps(),
        importFundamentals: async () => fundamentalDeps(),
        rescore: () => ({ kind: "ok" }),
        persistFairValues: () => item.report,
      });
      resetRefreshAndResearchLockForTests();
      const onDemand = await runRefreshAndResearch(
        { ticker: "WIDGET" },
        {
          now: () => new Date(AS_OF),
          readPriceDate: () => "2026-09-18",
          importPrices: async () => priceDeps(),
          importFundamentals: async () => fundamentalDeps(),
          score: () => ({ metrics: [], result: { asOf: AS_OF, researchScore: 40 } }),
          fairValue: () => item.report,
        },
      );
      const dailyStatus = daily.datasets.find((row) => row.dataset === "fair_value")?.status;
      expect(dailyStatus, item.name).toBe(item.status);
      expect(onDemand.categories.fairValue.status, item.name).toBe(dailyStatus);
      expect(onDemand.categories.fairValue.detail, item.name).toBe(fairValueRefreshOutcome(item.report).errorSummary);
    }
  });
});

function outcomeReport(overrides: Partial<FairValueRefreshReport>): FairValueRefreshReport {
  return {
    attempted: 1,
    inserted: 0,
    unchanged: 0,
    valuedInserted: 0,
    valuedUnchanged: 0,
    failed: [],
    unsupported: 0,
    noValue: 0,
    flagged: 0,
    caution: 0,
    withheld: 0,
    persistenceRefused: false,
    ...overrides,
  };
}

function priceDeps(): PricesImportReport {
  return {
    kind: "prices",
    startedAt: AS_OF,
    finishedAt: AS_OF,
    succeeded: ["WIDGET"],
    failed: [],
    barsUpserted: 1,
  };
}

function fundamentalDeps(): YahooFundamentalsReport {
  return {
    kind: "fundamentals-yahoo",
    startedAt: AS_OF,
    finishedAt: AS_OF,
    attempted: 1,
    upserted: 0,
    inserted: 0,
    filled: 0,
    unchanged: 1,
    skippedHadFilings: 0,
    skippedOtherSource: 0,
    instrumentsUpdated: 0,
    instrumentsUnchanged: 1,
    instrumentsSkippedFresh: 1,
    instrumentsFetched: 0,
    failed: [],
  };
}
