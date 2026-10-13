import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { fairValueRuns, instruments, priceBars } from "@/db/schema";
import { importYahooPrices } from "@/ingest/import-prices";
import type { PricesImportReport } from "@/ingest/types";
import { importYahooFundamentals, type YahooFundamentalsReport } from "@/market/ingest-fundamentals-yahoo";
import type { FairValueRefreshReport } from "@/refresh/fair-value";
import {
  loadOnDemandCategoryStatus,
  resetRefreshAndResearchLockForTests,
  runRefreshAndResearch,
} from "@/refresh/on-demand";
import { scoreTicker } from "@/scoring/run-ticker";

vi.mock("@/ingest/providers/yahoo-prices", () => ({
  fetchYahooDailyBars: vi.fn(async () => [
    {
      barDate: "2026-10-12",
      open: 12,
      high: 12,
      low: 12,
      close: 12,
      volume: 100,
      adjClose: 12,
    },
  ]),
}));

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
const PREV_READONLY = process.env.BURSA_SNAPSHOT_READONLY;
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

function seedInstrument(ticker = "MAYBANK", yahooTicker = "MAYBANK.KL") {
  const now = "2026-09-18T00:00:00.000Z";
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: ticker === "MAYBANK" ? "1155" : "1023",
      yahooTicker,
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

function seedBar(ticker: string, barDate: string, close: number) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get();
  if (!instrument) throw new Error(`missing ${ticker}`);
  getDb()
    .insert(priceBars)
    .values({
      instrumentId: instrument.id,
      barDate,
      open: close,
      high: close,
      low: close,
      close,
      volume: 500,
      adjClose: close,
      asOf: `${barDate}T16:00:00+08:00`,
      source: "yahoo",
      adjusted: true,
      retrievedAt: "2026-09-18T00:00:00.000Z",
    })
    .run();
}

function priceReport(succeeded: string[], failed: PricesImportReport["failed"] = []): PricesImportReport {
  return {
    kind: "prices",
    startedAt: "2026-10-13T00:00:00.000Z",
    finishedAt: "2026-10-13T00:00:01.000Z",
    succeeded,
    failed,
    barsUpserted: succeeded.length,
  };
}

function fundamentalsReport(overrides: Partial<YahooFundamentalsReport> = {}): YahooFundamentalsReport {
  return {
    kind: "fundamentals-yahoo",
    startedAt: "2026-10-13T00:00:00.000Z",
    finishedAt: "2026-10-13T00:00:01.000Z",
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
    ...overrides,
  };
}

function fairReport(overrides: Partial<FairValueRefreshReport> = {}): FairValueRefreshReport {
  return {
    attempted: 1,
    inserted: 1,
    unchanged: 0,
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

function scored(date: string, close: number) {
  return {
    metrics: [
      { id: "last_close", value: close, period: date },
      { id: "last_trade_date", value: null, period: date },
    ],
    result: { asOf: "2026-10-13T01:00:00.000Z", researchScore: 40 },
  };
}

describe("on-demand refresh and research", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-on-demand-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetRefreshAndResearchLockForTests();
    resetDb();
    getDb();
    seedInstrument();
    seedBar("MAYBANK", "2026-09-18", 10);
  });

  afterEach(() => {
    resetRefreshAndResearchLockForTests();
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
    if (PREV_READONLY === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
    else process.env.BURSA_SNAPSHOT_READONLY = PREV_READONLY;
  });

  it("runs prices, fundamentals, then research calculations", async () => {
    const order: string[] = [];
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        now: sequentialClock(),
        importPrices: async (options) => {
          order.push("prices");
          expect(options).toMatchObject({
            onlyTicker: "MAYBANK",
            range: "5d",
            listedOnly: true,
            skipAlerts: true,
            skipUniverseSeed: true,
          });
          return priceReport(["MAYBANK"]);
        },
        importFundamentals: async (options) => {
          order.push("fundamentals");
          expect(options.onlyTicker).toBe("MAYBANK");
          return fundamentalsReport();
        },
        score: () => {
          order.push("scores");
          return scored("2026-09-18", 10);
        },
        fairValue: (args) => {
          order.push("fairValue");
          expect(args.onlyTicker).toBe("MAYBANK");
          return fairReport();
        },
      },
    );

    expect(order).toEqual(["prices", "fundamentals", "scores", "fairValue"]);
    expect(report.startedAt < report.completedAt).toBe(true);
    expect(report.market.cadence).toBe("end-of-day");
    expect(report.market.realtime).toBe(false);
    expect(report.categories.events.status).toBe("NO_SOURCE");
    expect(report.categories.news.status).toBe("NO_SOURCE");
    expect(report.categories.announcements.status).toBe("NO_SOURCE");
    expect(report.categories.events.updatedThisRun).toBe(false);
    expect(report.categories.news.updatedThisRun).toBe(false);
    expect(report.calculations).toEqual({ scores: true, fairValue: true });
    expect(report.market.updatedThisRun).toBe(false);
    expect(report.categories.prices.status).toBe("UNCHANGED");
    expect(report.overall).toBe("SUCCESS");
    expect(report.durable).toBe(true);
    expect(report.persistence).toBe("local-sqlite");
  });

  it("replaces a stale stored price and recalculates research from that bar", async () => {
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importPrices: async () => {
          seedBar("MAYBANK", "2026-10-12", 12);
          return priceReport(["MAYBANK"]);
        },
        importFundamentals: async () => fundamentalsReport(),
        score: scoreTicker,
        fairValue: undefined,
      },
    );

    expect(report.overall).toBe("SUCCESS");
    expect(report.market.previousDate).toBe("2026-09-18");
    expect(report.market.latestDate).toBe("2026-10-12");
    expect(report.market.updatedThisRun).toBe(true);
    expect(report.research.priceDateUsed).toBe("2026-10-12");
    expect(report.research.priceUsed).toBe(12);
    expect(report.research.ranAt).not.toBe(report.market.latestDate);
    expect(report.categories.scores.status).toBe("NO_DATA");
    expect(report.calculations.scores).toBe(false);
    expect(report.categories.fairValue.status).toBe("NO_DATA");
    expect(report.categories.fairValue.updatedThisRun).toBe(false);
    expect(report.categories.fairValue.detail).toContain("did not produce a value");

    const saved = getDb().select().from(fairValueRuns).all();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.currentPrice).toBe(12);
    expect(saved[0]?.valuationDate).toBe("2026-10-12");

    const stored = loadOnDemandCategoryStatus("MAYBANK");
    expect(stored.prices?.status).toBe("SUCCESS");
    expect(stored.prices?.lastSuccessfulAt).toBeTruthy();
    expect(stored.events?.status).toBe("NO_SOURCE");
    expect(stored.events?.lastSuccessfulAt).toBeNull();
    expect(stored.news?.status).toBe("NO_SOURCE");
    expect(stored.news?.updatedThisRun).toBe(false);
  });

  it("keeps the old price date when the price fetch fails", async () => {
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importPrices: async () =>
          priceReport([], [{ ticker: "MAYBANK", yahooTicker: "MAYBANK.KL", reason: "Yahoo timeout" }]),
        importFundamentals: async () => fundamentalsReport(),
        score: scoreTicker,
        fairValue: () => fairReport(),
      },
    );

    const latest = getDb()
      .select({ barDate: priceBars.barDate })
      .from(priceBars)
      .orderBy(priceBars.barDate)
      .all();
    expect(latest.map((row) => row.barDate)).toEqual(["2026-09-18"]);
    expect(report.overall).not.toBe("SUCCESS");
    expect(report.overall).toBe("PARTIAL");
    expect(report.market.previousDate).toBe("2026-09-18");
    expect(report.market.latestDate).toBe("2026-09-18");
    expect(report.market.updatedThisRun).toBe(false);
    expect(report.categories.prices.status).toBe("SOURCE_FAILED");
    expect(report.categories.prices.lastSuccessfulAt).toBeNull();
    expect(report.research.priceDateUsed).toBe("2026-09-18");
    expect(report.research.priceUsed).toBe(10);
    expect(report.instruments).toMatchObject({ attempted: 1, priceFailed: 1, priceSucceeded: 0 });
  });

  it("reports a partial run when fundamentals fail after a price update", async () => {
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importPrices: async () => {
          seedBar("MAYBANK", "2026-10-12", 12);
          return priceReport(["MAYBANK"]);
        },
        importFundamentals: async () => {
          throw new Error("fundamentals down");
        },
        score: () => scored("2026-10-12", 12),
        fairValue: () => fairReport(),
      },
    );

    expect(report.overall).toBe("PARTIAL");
    expect(report.market.updatedThisRun).toBe(true);
    expect(report.market.latestDate).toBe("2026-10-12");
    expect(report.categories.fundamentals.status).toBe("SOURCE_FAILED");
    expect(report.categories.fundamentals.detail).toContain("fundamentals down");
    expect(report.calculations.scores).toBe(true);
    expect(report.categories.events.status).toBe("NO_SOURCE");
  });

  it("does not start a second run while one is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const importPrices = vi.fn(async () => {
      await gate;
      return priceReport(["MAYBANK"]);
    });
    const first = runRefreshAndResearch(
      { ticker: "maybank" },
      {
        importPrices,
        importFundamentals: async () => fundamentalsReport(),
        score: () => scored("2026-09-18", 10),
        fairValue: () => fairReport(),
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const second = await runRefreshAndResearch({ ticker: "MAYBANK" });
    expect(second.overall).toBe("ALREADY_RUNNING");
    expect(second.durable).toBe(false);
    expect(second.instruments.attempted).toBe(0);
    expect(importPrices).toHaveBeenCalledTimes(1);
    release();
    const finished = await first;
    expect(finished.overall).toBe("SUCCESS");
    expect(finished.market.updatedThisRun).toBe(false);
  });

  it("refuses the read-only snapshot without fetching", async () => {
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const importPrices = vi.fn();
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importPrices, readPriceDate: () => "2026-09-18" },
    );
    expect(report.overall).toBe("REFUSED");
    expect(report.durable).toBe(false);
    expect(report.persistence).toBe("refused-read-only-snapshot");
    expect(report.market.latestDate).toBe("2026-09-18");
    expect(report.market.updatedThisRun).toBe(false);
    expect(importPrices).not.toHaveBeenCalled();
    expect(report.categories.prices.status).toBe("NOT_RUN");
  });

  it("fetches fundamentals for one ticker and does not seed the price universe", async () => {
    seedInstrument("CIMB", "CIMB.KL");
    const seen: string[] = [];
    await importYahooFundamentals(
      {
        id: "test",
        annualPeriods: async (symbol: string) => {
          seen.push(symbol);
          return [];
        },
      },
      { onlyTicker: "MAYBANK", rateLimitMs: 0 },
    );
    expect(seen).toContain("MAYBANK.KL");
    expect(seen.some((symbol) => symbol.startsWith("CIMB"))).toBe(false);

    await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    const names = getDb().select({ ticker: instruments.ticker }).from(instruments).all();
    expect(names.map((row) => row.ticker).sort()).toEqual(["CIMB", "MAYBANK"]);
    const latest = getDb()
      .select({ barDate: priceBars.barDate })
      .from(priceBars)
      .where(eq(priceBars.instrumentId, getDb().select().from(instruments).where(eq(instruments.ticker, "MAYBANK")).get()!.id))
      .orderBy(priceBars.barDate)
      .all();
    expect(latest.at(-1)?.barDate).toBe("2026-10-12");
  });
});

function sequentialClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 13, 0, 0, tick++));
}
