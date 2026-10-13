import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { instruments, priceBars } from "@/db/schema";
import type { PricesImportReport } from "@/ingest/types";
import type { YahooFundamentalsReport } from "@/market/ingest-fundamentals-yahoo";
import type { FairValueRefreshReport } from "@/refresh/fair-value";
import { runRefreshAndResearch } from "@/refresh/on-demand";
import { WATCHLIST_PACE_MS, cancelWatchlistRefresh, resetWatchlistRefreshForTests, runWatchlistRefreshAndResearch, type WatchlistProgress } from "@/refresh/watchlist";

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

function seedInstrument(ticker: string, watchlist: boolean) {
  const now = "2026-09-18T00:00:00.000Z";
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: null,
      yahooTicker: `${ticker}.KL`,
      name: `${ticker} Test`,
      sector: "Industrial",
      industry: "Widgets",
      listingBoard: "MAIN",
      instrumentType: "COMMON_STOCK",
      researchProfile: "GENERAL",
      pn17: false,
      currency: "MYR",
      shariahCompliant: null,
      watchlist,
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
      volume: 100,
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

function fundamentalsReport(): YahooFundamentalsReport {
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
  };
}

function fairReport(): FairValueRefreshReport {
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

function pipelineDeps(importPrices: (options: { onlyTicker?: string }) => Promise<PricesImportReport>) {
  return {
    importPrices,
    importFundamentals: async () => fundamentalsReport(),
    score: (ticker: string) => scored("2026-09-18", 10),
    fairValue: () => fairReport(),
    sleep: async () => undefined,
    paceMs: 0 as const,
  };
}

describe("watchlist refresh and research", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-watchlist-refresh-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetWatchlistRefreshForTests();
    resetDb();
    getDb();
    for (const ticker of ["AAA", "BBB", "CCC"]) {
      seedInstrument(ticker, true);
      seedBar(ticker, "2026-09-18", 10);
    }
    seedInstrument("DDD", false);
    seedBar("DDD", "2026-09-18", 4);
  });

  afterEach(() => {
    resetWatchlistRefreshForTests();
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
    if (PREV_READONLY === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
    else process.env.BURSA_SNAPSHOT_READONLY = PREV_READONLY;
  });

  it("refreshes the watchlist sequentially and reports progress and freshness", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const progress: WatchlistProgress[] = [];
    const pauses: number[] = [];
    const report = await runWatchlistRefreshAndResearch(
      {},
      {
        importPrices: async (options) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          order.push(options.onlyTicker ?? "");
          active -= 1;
          return priceReport([options.onlyTicker ?? ""]);
        },
        importFundamentals: async () => fundamentalsReport(),
        score: () => scored("2026-09-18", 10),
        fairValue: () => fairReport(),
        sleep: async (ms) => {
          pauses.push(ms);
        },
        onProgress: (row) => progress.push(row),
      },
    );

    expect(order).toEqual(["AAA", "BBB", "CCC"]);
    expect(maxActive).toBe(1);
    expect(pauses).toEqual([WATCHLIST_PACE_MS, WATCHLIST_PACE_MS]);
    expect(report.watchlistSize).toBe(3);
    expect(report.attempted).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.overall).toBe("SUCCESS");
    expect(report.market.cadence).toBe("end-of-day");
    expect(report.market.realtime).toBe(false);
    expect(report.market.oldestPreviousDate).toBe("2026-09-18");
    expect(report.market.latestMarketDate).toBe("2026-09-18");
    expect(report.market.updatedCount).toBe(0);
    expect(report.persistence).toBe("local-sqlite");
    expect(report.durable).toBe(true);
    expect(report.sourcesNotUpdated).toEqual(["announcements", "events", "news"]);
    expect(report.results.every((row) => row.categories.events.status === "NO_SOURCE")).toBe(true);
    expect(report.results.every((row) => row.categories.news.updatedThisRun === false)).toBe(true);
    expect(report.calculations).toEqual({ scores: 3, fairValue: 3 });
    expect(progress.some((row) => row.current === "BBB" && row.completed === 1 && row.failed === 0)).toBe(true);
    expect(progress.at(-1)?.completed).toBe(3);
    expect(order).not.toContain("DDD");
  });

  it("continues after one ticker fails and does not treat the old price as updated", async () => {
    const report = await runWatchlistRefreshAndResearch(
      { paceMs: 0 },
      {
        importPrices: async (options) => {
          const ticker = options.onlyTicker ?? "";
          if (ticker === "BBB") {
            return priceReport([], [{ ticker, yahooTicker: "BBB.KL", reason: "Yahoo timeout" }]);
          }
          seedBar(ticker, "2026-10-13", 12);
          return priceReport([ticker]);
        },
        importFundamentals: async () => fundamentalsReport(),
        score: (ticker) => scored(ticker === "BBB" ? "2026-09-18" : "2026-10-13", ticker === "BBB" ? 10 : 12),
        fairValue: () => fairReport(),
      },
    );

    const bbb = report.results.find((row) => row.ticker === "BBB");
    const aaa = report.results.find((row) => row.ticker === "AAA");
    expect(report.overall).toBe("PARTIAL");
    expect(report.failedTickers).toEqual(["BBB"]);
    expect(report.completed).toBe(3);
    expect(bbb?.market.updatedThisRun).toBe(false);
    expect(bbb?.market.latestDate).toBe("2026-09-18");
    expect(bbb?.categories.prices.status).toBe("SOURCE_FAILED");
    expect(aaa?.market.updatedThisRun).toBe(true);
    expect(aaa?.market.latestDate).toBe("2026-10-13");
    expect(report.results.map((row) => row.ticker)).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("retries only the failed ticker", async () => {
    const firstPrices = vi.fn(async (options: { onlyTicker?: string }) => {
      if (options.onlyTicker === "BBB") {
        return priceReport([], [{ ticker: "BBB", yahooTicker: "BBB.KL", reason: "Yahoo timeout" }]);
      }
      return priceReport([options.onlyTicker ?? ""]);
    });
    const first = await runWatchlistRefreshAndResearch({ paceMs: 0 }, pipelineDeps(firstPrices));
    expect(first.failedTickers).toEqual(["BBB"]);

    const retryPrices = vi.fn(async (options: { onlyTicker?: string }) => priceReport([options.onlyTicker ?? ""]));
    const retry = await runWatchlistRefreshAndResearch(
      { onlyTickers: first.failedTickers, paceMs: 0 },
      pipelineDeps(retryPrices),
    );
    expect(retryPrices.mock.calls.map((call) => call[0]?.onlyTicker)).toEqual(["BBB"]);
    expect(retry.attempted).toBe(1);
    expect(retry.results.map((row) => row.ticker)).toEqual(["BBB"]);
    expect(retry.overall).toBe("SUCCESS");
  });

  it("refuses a second watchlist run and a single-stock run while one is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const importPrices = vi.fn(async () => {
      await gate;
      return priceReport(["AAA"]);
    });
    const first = runWatchlistRefreshAndResearch({ paceMs: 0 }, pipelineDeps(importPrices));
    await new Promise((resolve) => setImmediate(resolve));
    const second = await runWatchlistRefreshAndResearch({ paceMs: 0 }, pipelineDeps(vi.fn()));
    const singlePrices = vi.fn();
    const single = await runRefreshAndResearch({ ticker: "AAA" }, { importPrices: singlePrices });
    expect(second.overall).toBe("ALREADY_RUNNING");
    expect(second.durable).toBe(false);
    expect(single.overall).toBe("ALREADY_RUNNING");
    expect(singlePrices).not.toHaveBeenCalled();
    expect(importPrices).toHaveBeenCalledTimes(1);
    release();
    const finished = await first;
    expect(finished.attempted).toBe(3);
  });

  it("stops before the next ticker when cancellation is requested", async () => {
    const order: string[] = [];
    const report = await runWatchlistRefreshAndResearch(
      { paceMs: 0 },
      pipelineDeps(async (options) => {
        order.push(options.onlyTicker ?? "");
        if (order.length === 1) cancelWatchlistRefresh();
        return priceReport([options.onlyTicker ?? ""]);
      }),
    );
    expect(order).toEqual(["AAA"]);
    expect(report.cancelled).toBe(true);
    expect(report.overall).toBe("CANCELLED");
    expect(report.skipped).toEqual(["BBB", "CCC"]);
    expect(report.completed).toBe(1);
  });

  it("refuses snapshot mode before fetching", async () => {
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const importPrices = vi.fn();
    const report = await runWatchlistRefreshAndResearch(
      {},
      { importPrices, listTickers: () => ["AAA", "BBB", "CCC"] },
    );
    expect(report.overall).toBe("REFUSED");
    expect(report.durable).toBe(false);
    expect(report.persistence).toBe("refused-read-only-snapshot");
    expect(report.attempted).toBe(0);
    expect(importPrices).not.toHaveBeenCalled();
    expect(report.notes.some((note) => note.includes("deployed website"))).toBe(true);
  });
});
