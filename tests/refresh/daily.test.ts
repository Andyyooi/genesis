import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb, getSqlite } from "@/db/client";
import { financialPeriods, instruments, priceBars, refreshRuns } from "@/db/schema";
import type { EventDraft, EventSourceProvider } from "@/events/types";
import type { PricesImportReport } from "@/ingest/types";
import type { YahooFundamentalsReport } from "@/market/ingest-fundamentals-yahoo";
import { runDailyRefresh } from "@/refresh/daily";
import { loadLastSuccessfulAt } from "@/refresh/persist";
import { advancesLastSuccessful, combineOverallStatus } from "@/refresh/types";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
let tempDir = "";

function resetDb() {
  try {
    getSqlite().close();
  } catch {
    /* ignore */
  }
  const g = globalThis as { sqlite?: unknown };
  delete g.sqlite;
}

function seedInstrument(ticker: string) {
  const now = new Date().toISOString();
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: "1155",
      yahooTicker: `${ticker}.KL`,
      name: `${ticker} Test`,
      sector: "Financial Services",
      industry: "Banks",
      listingBoard: "MAIN",
      instrumentType: "COMMON_STOCK",
      researchProfile: "BANK",
      pn17: false,
      currency: "MYR",
      shariahCompliant: null,
      watchlist: true,
      listingStatus: "listed",
      universeSource: "test",
      universeSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function seedPrice(ticker: string, barDate: string, close: number) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get()!;
  getDb()
    .insert(priceBars)
    .values({
      instrumentId: instrument.id,
      barDate,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
      adjClose: close,
      asOf: `${barDate}T16:00:00+08:00`,
      source: "yahoo",
      adjusted: true,
      retrievedAt: "2026-09-23T10:00:00.000Z",
    })
    .run();
}

function seedFundamental(ticker: string) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get()!;
  getDb()
    .insert(financialPeriods)
    .values({
      instrumentId: instrument.id,
      fiscalYear: 2024,
      fiscalQuarter: null,
      periodEnd: "2024-12-31",
      fiscalPeriod: "FY2024",
      availableAt: null,
      filingDate: null,
      availableAtSource: null,
      retrievedAt: "2026-09-23T10:00:00.000Z",
      statementType: "annual",
      source: "yahoo",
      actualOrEstimate: "actual",
      lineItemsJson: JSON.stringify({ revenue: 1e9, pat: 1e8, eps: 0.5 }),
    })
    .run();
}

function emptyFundReport(over: Partial<YahooFundamentalsReport> = {}): YahooFundamentalsReport {
  return {
    kind: "fundamentals-yahoo",
    startedAt: "2026-09-24T09:00:00.000Z",
    finishedAt: "2026-09-24T09:01:00.000Z",
    attempted: 1,
    upserted: 0,
    inserted: 0,
    filled: 0,
    unchanged: 1,
    skippedHadFilings: 0,
    skippedOtherSource: 0,
    instrumentsUpdated: 0,
    instrumentsUnchanged: 1,
    instrumentsSkippedFresh: 0,
    instrumentsFetched: 1,
    failed: [],
    ...over,
  };
}

describe("Phase 18B daily refresh", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-refresh-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetDb();
    getDb();
    seedInstrument("MAYBANK");
    seedPrice("MAYBANK", "2026-09-23", 10.32);
    seedFundamental("MAYBANK");
  });

  afterEach(() => {
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  });

  it("records SUCCESS prices without wiping prior bars on later failure", async () => {
    const first = await runDailyRefresh({
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: "2026-09-24T09:00:00.000Z",
          finishedAt: "2026-09-24T09:01:00.000Z",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 2,
        }) satisfies PricesImportReport,
      importFundamentals: async () => emptyFundReport(),
      rescore: () => ({ kind: "ok" }),
      now: () => new Date("2026-09-24T10:00:00.000Z"),
    });
    expect(first.datasets.find((d) => d.dataset === "prices")?.status).toBe("SUCCESS");
    expect(loadLastSuccessfulAt("prices", "yahoo")).toBeTruthy();

    await runDailyRefresh({
      importPrices: async () => {
        throw new Error("Yahoo down");
      },
      importFundamentals: async () => emptyFundReport(),
      rescore: () => ({ kind: "ok" }),
      now: () => new Date("2026-09-25T10:00:00.000Z"),
    });

    const bar = getDb().select().from(priceBars).all()[0]!;
    expect(bar.close).toBe(10.32);
    expect(bar.barDate).toBe("2026-09-23");
    const lastFail = getDb()
      .select()
      .from(refreshRuns)
      .where(eq(refreshRuns.dataset, "prices"))
      .all()
      .at(-1)!;
    expect(lastFail.status).toBe("SOURCE_FAILED");
    expect(lastFail.lastSuccessfulAt).toBe(first.datasets.find((d) => d.dataset === "prices")!.completedAt);
  });

  it("marks events and news as NO_SOURCE without deleting existing rows", async () => {
    const summary = await runDailyRefresh({
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 1,
        }) satisfies PricesImportReport,
      importFundamentals: async () => emptyFundReport(),
      eventsProvider: null,
      newsAvailable: false,
      rescore: () => ({ kind: "ok" }),
    });
    expect(summary.datasets.find((d) => d.dataset === "events")?.status).toBe("NO_SOURCE");
    expect(summary.datasets.find((d) => d.dataset === "news")?.status).toBe("NO_SOURCE");
    expect(getDb().select().from(financialPeriods).all()).toHaveLength(1);
  });

  it("isolates dataset failures (partial overall)", async () => {
    const summary = await runDailyRefresh({
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 1,
        }) satisfies PricesImportReport,
      importFundamentals: async () => {
        throw new Error("fundamentals outage");
      },
      rescore: () => ({ kind: "ok" }),
    });
    expect(summary.datasets.find((d) => d.dataset === "prices")?.status).toBe("SUCCESS");
    expect(summary.datasets.find((d) => d.dataset === "fundamentals")?.status).toBe("SOURCE_FAILED");
    expect(summary.overallStatus).toBe("PARTIAL");
    expect(getDb().select().from(financialPeriods).all()[0]!.lineItemsJson).toContain("1000000000");
  });

  it("treats unchanged fundamentals as UNCHANGED and advances last_successful_at", async () => {
    const summary = await runDailyRefresh({
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 0,
        }) satisfies PricesImportReport,
      importFundamentals: async () => emptyFundReport(),
      rescore: () => ({ kind: "ok" }),
    });
    expect(summary.datasets.find((d) => d.dataset === "fundamentals")?.status).toBe("UNCHANGED");
    expect(advancesLastSuccessful("UNCHANGED")).toBe(true);
    expect(loadLastSuccessfulAt("fundamentals", "yahoo")).toBeTruthy();
  });

  it("records SOURCE_FAILED when an events provider throws, preserving data", async () => {
    const exploding: EventSourceProvider = {
      id: "explode",
      reliability: "UNKNOWN",
      async list(): Promise<EventDraft[]> {
        throw new Error("provider boom");
      },
    };
    const summary = await runDailyRefresh({
      importPrices: async () =>
        ({
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 1,
        }) satisfies PricesImportReport,
      importFundamentals: async () => emptyFundReport(),
      eventsProvider: exploding,
      rescore: () => ({ kind: "ok" }),
    });
    expect(summary.datasets.find((d) => d.dataset === "events")?.status).toBe("SOURCE_FAILED");
  });

  it("keeps scoring concern penalty off and overall SUCCESS when prices/fundamentals ok", () => {
    const config = loadScoringConfig();
    expect(config.concerns.apply_score_penalty).toBe(false);
    expect(
      combineOverallStatus([
        {
          dataset: "prices",
          source: "yahoo",
          status: "SUCCESS",
          startedAt: "",
          completedAt: "",
          marketDate: null,
          attemptedCount: 1,
          updatedCount: 1,
          unchangedCount: 0,
          failedCount: 0,
          unavailableCount: 0,
          lastSuccessfulAt: null,
          errorSummary: null,
        },
        {
          dataset: "fundamentals",
          source: "yahoo",
          status: "UNCHANGED",
          startedAt: "",
          completedAt: "",
          marketDate: null,
          attemptedCount: 1,
          updatedCount: 0,
          unchangedCount: 1,
          failedCount: 0,
          unavailableCount: 0,
          lastSuccessfulAt: null,
          errorSummary: null,
        },
      ]),
    ).toBe("SUCCESS");
  });
});
