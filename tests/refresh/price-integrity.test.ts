import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db/client";
import { instruments, priceBars } from "@/db/schema";
import { importYahooPrices } from "@/ingest/import-prices";
import { fetchYahooDailyBars, type YahooBar } from "@/ingest/providers/yahoo-prices";
import type { YahooFundamentalsReport } from "@/market/ingest-fundamentals-yahoo";
import type { FairValueRefreshReport } from "@/refresh/fair-value";
import { runRefreshAndResearch } from "@/refresh/on-demand";
import { resetWatchlistRefreshForTests, runWatchlistRefreshAndResearch } from "@/refresh/watchlist";

vi.mock("@/ingest/providers/yahoo-prices", async () => {
  const actual = await vi.importActual<typeof import("@/ingest/providers/yahoo-prices")>("@/ingest/providers/yahoo-prices");
  return { ...actual, fetchYahooDailyBars: vi.fn() };
});

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

function seed(ticker: string, watchlist = true) {
  const now = "2026-09-18T00:00:00.000Z";
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: "1155",
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

function yahooBar(barDate: string, close: number, extra: Partial<YahooBar> = {}): YahooBar {
  return { barDate, open: close, high: close, low: close, close, volume: 100, adjClose: close, ...extra };
}

function storedBars(ticker: string) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get();
  if (!instrument) return [];
  return getDb()
    .select({ barDate: priceBars.barDate, close: priceBars.close })
    .from(priceBars)
    .where(eq(priceBars.instrumentId, instrument.id))
    .orderBy(priceBars.barDate)
    .all();
}

function fundamentals(overrides: Partial<YahooFundamentalsReport> = {}): YahooFundamentalsReport {
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

function fairValue(overrides: Partial<FairValueRefreshReport> = {}): FairValueRefreshReport {
  return {
    attempted: 1,
    inserted: 0,
    unchanged: 1,
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

function scored(researchScore: number | null, date = "2026-10-12", close = 11) {
  return {
    metrics: [
      { id: "last_close", value: close, period: date },
      { id: "last_trade_date", value: null, period: date },
    ],
    result: { asOf: "2026-10-13T01:00:00.000Z", researchScore },
  };
}

describe("refresh price integrity", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-price-integrity-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetWatchlistRefreshForTests();
    resetDb();
    getDb();
    seed("MAYBANK");
    seedBar("MAYBANK", "2026-09-18", 10);
    vi.mocked(fetchYahooDailyBars).mockReset();
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

  it("persists a valid newer bar and reports that price as refreshed", async () => {
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-12", 11)]);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importFundamentals: async () => fundamentals(), score: () => scored(40), fairValue: () => fairValue({ inserted: 1, unchanged: 0 }) },
    );
    expect(storedBars("MAYBANK")).toEqual([
      { barDate: "2026-09-18", close: 10 },
      { barDate: "2026-10-12", close: 11 },
    ]);
    expect(report.market.updatedThisRun).toBe(true);
    expect(report.market.latestDate).toBe("2026-10-12");
    expect(report.categories.prices.status).toBe("SUCCESS");
    expect(report.categories.fundamentals.status).toBe("UNCHANGED");
    expect(report.categories.fundamentals.detail).toContain("recheck window");
    expect(report.categories.fundamentals.updatedThisRun).toBe(false);
    expect(report.overall).toBe("SUCCESS");
  });

  it("does not replace stored bars with an empty, malformed, invalid-date, or failed response", async () => {
    const cases: Array<{ name: string; impl: () => Promise<YahooBar[]> }> = [
      { name: "empty", impl: async () => [] },
      { name: "malformed", impl: async () => [yahooBar("2026-10-12", Number.NaN)] },
      { name: "invalid date", impl: async () => [yahooBar("2099-01-01", 12)] },
      { name: "http", impl: async () => { throw new Error("Yahoo HTTP 503 for MAYBANK.KL"); } },
    ];
    for (const item of cases) {
      vi.mocked(fetchYahooDailyBars).mockImplementation(item.impl);
      const report = await runRefreshAndResearch(
        { ticker: "MAYBANK" },
        { importFundamentals: async () => fundamentals(), score: () => scored(40, "2026-09-18", 10), fairValue: () => fairValue() },
      );
      expect(storedBars("MAYBANK"), item.name).toEqual([{ barDate: "2026-09-18", close: 10 }]);
      expect(report.categories.prices.status, item.name).toBe("SOURCE_FAILED");
      expect(report.market.updatedThisRun, item.name).toBe(false);
      expect(report.market.latestDate, item.name).toBe("2026-09-18");
      expect(report.overall, item.name).toBe("PARTIAL");
    }
  });

  it("adds a missing historical session without moving the latest close", async () => {
    seedBar("MAYBANK", "2026-10-12", 12);
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-09-01", 1)]);
    const imported = await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    expect(imported.barsInserted).toBe(1);
    expect(imported.barsReimported).toBe(0);
    expect(imported.conflicts).toEqual([]);
    expect(storedBars("MAYBANK")).toEqual([
      { barDate: "2026-09-01", close: 1 },
      { barDate: "2026-09-18", close: 10 },
      { barDate: "2026-10-12", close: 12 },
    ]);

    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importFundamentals: async () => fundamentals(), score: () => scored(40, "2026-10-12", 12), fairValue: () => fairValue() },
    );
    expect(report.categories.prices.status).toBe("UNCHANGED");
    expect(report.categories.prices.detail).toBeNull();
    expect(report.market.updatedThisRun).toBe(false);
    expect(report.market.latestDate).toBe("2026-10-12");
    expect(storedBars("MAYBANK")).toHaveLength(3);
  });

  it("keeps a conflicting historical close and still stores the new sessions around it", async () => {
    seedBar("MAYBANK", "2026-10-12", 12);
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([
      yahooBar("2026-09-02", 7),
      yahooBar("2026-09-18", 4),
      yahooBar("2026-10-12", 12),
      yahooBar("2026-10-13", 13),
    ]);
    const imported = await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    expect(imported.succeeded).toEqual(["MAYBANK"]);
    expect(imported.barsInserted).toBe(2);
    expect(imported.barsReimported).toBe(1);
    expect(imported.conflicts).toEqual([
      { ticker: "MAYBANK", barDate: "2026-09-18", storedClose: 10, incomingClose: 4 },
    ]);
    expect(storedBars("MAYBANK")).toEqual([
      { barDate: "2026-09-02", close: 7 },
      { barDate: "2026-09-18", close: 10 },
      { barDate: "2026-10-12", close: 12 },
      { barDate: "2026-10-13", close: 13 },
    ]);
    const kept = getDb().select().from(priceBars).all().find((bar) => bar.barDate === "2026-09-18");
    const repeated = getDb().select().from(priceBars).all().find((bar) => bar.barDate === "2026-10-12");
    expect(kept?.retrievedAt).toBe("2026-09-18T00:00:00.000Z");
    expect(repeated?.retrievedAt).toBe("2026-09-18T00:00:00.000Z");

    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importFundamentals: async () => fundamentals(), score: () => scored(40, "2026-10-13", 13), fairValue: () => fairValue() },
    );
    expect(report.categories.prices.status).toBe("UNCHANGED");
    expect(report.categories.prices.detail).toContain("2026-09-18 kept 10");
    expect(report.market.latestDate).toBe("2026-10-13");
    expect(storedBars("MAYBANK").find((bar) => bar.barDate === "2026-09-18")?.close).toBe(10);
  });

  it("revises the latest stored session and ignores an unusable stored date", async () => {
    seedBar("MAYBANK", "9999-99-99", 50);
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([
      yahooBar("2026-09-18", 10),
      yahooBar("2026-10-13", 13),
    ]);
    const imported = await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    expect(imported.barsInserted).toBe(1);
    expect(imported.barsReimported).toBe(1);
    expect(imported.conflicts).toEqual([]);
    expect(storedBars("MAYBANK")).toEqual([
      { barDate: "2026-09-18", close: 10 },
      { barDate: "2026-10-13", close: 13 },
      { barDate: "9999-99-99", close: 50 },
    ]);

    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-13", 14)]);
    const revised = await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    expect(revised.barsInserted).toBe(0);
    expect(revised.barsUpserted).toBe(1);
    expect(revised.conflicts).toEqual([]);
    expect(storedBars("MAYBANK").find((bar) => bar.barDate === "2026-10-13")?.close).toBe(14);
  });

  it("rolls back a newer bar when persistence fails before the ticker is saved", async () => {
    getSqlite().exec(`
      CREATE TRIGGER abort_incomplete_price BEFORE INSERT ON price_bars
      WHEN NEW.bar_date = '2026-10-14'
      BEGIN
        SELECT RAISE(ABORT, 'persist failed');
      END;
    `);
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-13", 11), yahooBar("2026-10-14", 12)]);
    const imported = await importYahooPrices({
      onlyTicker: "MAYBANK",
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
      skipUniverseSeed: true,
    });
    expect(imported.failed.map((row) => row.ticker)).toEqual(["MAYBANK"]);
    expect(imported.succeeded).toEqual([]);
    expect(imported.conflicts).toEqual([]);
    expect(imported.barsInserted).toBe(0);
    expect(storedBars("MAYBANK")).toEqual([{ barDate: "2026-09-18", close: 10 }]);

    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-13", 11), yahooBar("2026-10-14", 12)]);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importFundamentals: async () => fundamentals(), score: () => scored(40, "2026-09-18", 10), fairValue: () => fairValue() },
    );
    expect(report.categories.prices.status).toBe("SOURCE_FAILED");
    expect(report.market.updatedThisRun).toBe(false);
    expect(report.market.latestDate).toBe("2026-09-18");
    expect(storedBars("MAYBANK")).toEqual([{ barDate: "2026-09-18", close: 10 }]);
  });

  it("distinguishes missing fundamentals, score gaps, and unsupported Fair Value from a price update", async () => {
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-12", 11)]);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importFundamentals: async () =>
          fundamentals({
            unchanged: 0,
            instrumentsUnchanged: 0,
            instrumentsSkippedFresh: 0,
            failed: [
              {
                ticker: "MAYBANK",
                yahooTicker: "MAYBANK.KL",
                mappingTried: ["MAYBANK.KL"],
                code: "NO_DATA",
                reason: "Yahoo returned no annual statements (unavailable, not invented)",
              },
            ],
          }),
        score: () => scored(null),
        fairValue: () => fairValue({ inserted: 1, unchanged: 0, unsupported: 1, noValue: 1 }),
      },
    );
    expect(report.categories.prices.updatedThisRun).toBe(true);
    expect(report.categories.fundamentals.status).toBe("NO_DATA");
    expect(report.categories.fundamentals.updatedThisRun).toBe(false);
    expect(report.categories.scores.status).toBe("NO_DATA");
    expect(report.categories.scores.updatedThisRun).toBe(false);
    expect(report.categories.fairValue.status).toBe("NO_DATA");
    expect(report.categories.fairValue.detail).toContain("No Fair Value model");
    expect(report.categories.fairValue.updatedThisRun).toBe(false);
    expect(report.overall).toBe("SUCCESS");
    expect(report.calculations).toEqual({ scores: false, fairValue: false });
  });

  it("reports a partial run when scoring fails after the price was saved", async () => {
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-12", 11)]);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importFundamentals: async () => fundamentals({ instrumentsSkippedFresh: 0, instrumentsUpdated: 1, instrumentsUnchanged: 0, unchanged: 0, upserted: 1 }),
        score: () => { throw new Error("score broke"); },
        fairValue: () => fairValue({ inserted: 1, unchanged: 0 }),
      },
    );
    expect(report.overall).toBe("PARTIAL");
    expect(report.categories.prices.status).toBe("SUCCESS");
    expect(report.categories.fundamentals.status).toBe("SUCCESS");
    expect(report.categories.scores.status).toBe("SOURCE_FAILED");
    expect(report.categories.fairValue.status).toBe("SOURCE_FAILED");
    expect(report.categories.fairValue.detail).toContain("research scoring failed");
    expect(storedBars("MAYBANK").at(-1)).toEqual({ barDate: "2026-10-12", close: 11 });
  });

  it("repeats a price refresh without duplicating bars", async () => {
    vi.mocked(fetchYahooDailyBars).mockResolvedValue([yahooBar("2026-10-12", 11)]);
    await importYahooPrices({ onlyTicker: "MAYBANK", listedOnly: true, skipAlerts: true, range: "5d", rateLimitMs: 0, skipUniverseSeed: true });
    await importYahooPrices({ onlyTicker: "MAYBANK", listedOnly: true, skipAlerts: true, range: "5d", rateLimitMs: 0, skipUniverseSeed: true });
    expect(storedBars("MAYBANK")).toEqual([
      { barDate: "2026-09-18", close: 10 },
      { barDate: "2026-10-12", close: 11 },
    ]);
    const second = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { importFundamentals: async () => fundamentals(), score: () => scored(40), fairValue: () => fairValue() },
    );
    expect(second.market.updatedThisRun).toBe(false);
    expect(second.categories.prices.status).toBe("UNCHANGED");
    expect(storedBars("MAYBANK")).toHaveLength(2);
  });

  it("retries a failed watchlist name without rewriting a successful price", async () => {
    seed("BBB");
    seedBar("BBB", "2026-09-18", 8);
    vi.mocked(fetchYahooDailyBars).mockImplementation(async (yahooTicker: string) => {
      if (yahooTicker.startsWith("BBB")) throw new Error("Yahoo HTTP 500 for BBB.KL");
      return [yahooBar("2026-10-12", 11)];
    });
    const first = await runWatchlistRefreshAndResearch(
      { paceMs: 0 },
      { importFundamentals: async () => fundamentals(), score: () => scored(40), fairValue: () => fairValue({ inserted: 1, unchanged: 0 }) },
    );
    expect(first.failedTickers).toEqual(["BBB"]);
    expect(storedBars("MAYBANK").at(-1)?.close).toBe(11);
    const maybankBefore = storedBars("MAYBANK");

    vi.mocked(fetchYahooDailyBars).mockImplementation(async () => [yahooBar("2026-10-12", 9)]);
    const retry = await runWatchlistRefreshAndResearch(
      { onlyTickers: first.failedTickers, paceMs: 0 },
      { importFundamentals: async () => fundamentals(), score: () => scored(40, "2026-10-12", 9), fairValue: () => fairValue({ inserted: 1, unchanged: 0 }) },
    );
    expect(retry.results.map((row) => row.ticker)).toEqual(["BBB"]);
    expect(storedBars("MAYBANK")).toEqual(maybankBefore);
    expect(storedBars("BBB").at(-1)).toEqual({ barDate: "2026-10-12", close: 9 });
  });

  it("refuses snapshot mode before calling Yahoo", async () => {
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const report = await runRefreshAndResearch({ ticker: "MAYBANK" }, { readPriceDate: () => "2026-09-18" });
    expect(report.overall).toBe("REFUSED");
    expect(report.durable).toBe(false);
    expect(fetchYahooDailyBars).not.toHaveBeenCalled();
  });

  it("does not run a watchlist refresh beside an in-flight single-stock refresh", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        importPrices: async () => { await gate; return { kind: "prices", startedAt: "", finishedAt: "", succeeded: ["MAYBANK"], failed: [], barsUpserted: 0 }; },
        importFundamentals: async () => fundamentals(),
        score: () => scored(40, "2026-09-18", 10),
        fairValue: () => fairValue(),
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const watchlist = await runWatchlistRefreshAndResearch({ paceMs: 0 });
    expect(watchlist.overall).toBe("ALREADY_RUNNING");
    expect(fetchYahooDailyBars).not.toHaveBeenCalled();
    release();
    await first;
  });
});
