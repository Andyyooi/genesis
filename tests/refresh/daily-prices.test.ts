import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { instruments, priceBars, refreshRuns, trackRecordEntries } from "@/db/schema";
import { importYahooPrices } from "@/ingest/import-prices";
import { recentPriceDrop } from "@/lib/price-drop-flag";
import { runDailyRefresh } from "@/refresh/daily";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
let tempDir = "";

vi.mock("@/ingest/providers/yahoo-prices", () => ({
  fetchYahooDailyBars: vi.fn(async () => [
    {
      barDate: "2026-09-25",
      open: 10.1,
      high: 10.2,
      low: 10.0,
      close: 10.15,
      volume: 1000,
      adjClose: 10.15,
    },
    {
      barDate: "2026-09-26",
      open: 10.15,
      high: 10.4,
      low: 10.1,
      close: 10.35,
      volume: 1200,
      adjClose: 10.35,
    },
  ]),
}));

import { fetchYahooDailyBars } from "@/ingest/providers/yahoo-prices";

function resetDb() {
  const g = globalThis as { sqlite?: { close: () => void } };
  try {
    g.sqlite?.close();
  } catch {
    /* The singleton may already be closed. */
  }
  delete g.sqlite;
}

function seedInstrument() {
  const now = new Date().toISOString();
  getDb()
    .insert(instruments)
    .values({
      ticker: "MAYBANK",
      bursaCode: "1155",
      yahooTicker: "MAYBANK.KL",
      name: "Maybank Test",
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

function seedBar(barDate: string, close: number) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, "MAYBANK")).get()!;
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
      retrievedAt: "2026-01-15T10:00:00.000Z",
    })
    .run();
}

describe("daily price range and throttle", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-daily-prices-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetDb();
    getDb();
    seedInstrument();
    vi.mocked(fetchYahooDailyBars).mockClear();
  });

  afterEach(() => {
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  });

  it("daily refresh chooses each ticker's range automatically with rateLimitMs=100", async () => {
    const captured: unknown[] = [];
    await runDailyRefresh({
      importPrices: async (opts) => {
        captured.push(opts);
        return {
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 1,
        };
      },
      importFundamentals: async () => ({
        kind: "fundamentals-yahoo",
        startedAt: "a",
        finishedAt: "b",
        attempted: 1,
        upserted: 0,
        inserted: 0,
        filled: 0,
        unchanged: 0,
        skippedHadFilings: 0,
        skippedOtherSource: 0,
        instrumentsUpdated: 0,
        instrumentsUnchanged: 1,
        instrumentsSkippedFresh: 1,
        instrumentsFetched: 0,
        failed: [],
      }),
      rescore: () => ({ kind: "ok" }),
    });
    expect(captured[0]).toMatchObject({
      listedOnly: true,
      skipAlerts: true,
      range: "auto",
      rateLimitMs: 100,
      refreshTrackRecordHistory: true,
    });
  });

  it("requests each saved ticker once from its earliest pick date, including inactive names", async () => {
    const now = new Date().toISOString();
    for (const ticker of ["SAVED", "UNSAVED"]) getDb().insert(instruments).values({ ticker, name: ticker, yahooTicker: `${ticker}.KL`, instrumentType: "COMMON_STOCK", listingStatus: ticker === "SAVED" ? "inactive" : "listed", createdAt: now, updatedAt: now }).run();
    for (const [ticker, pickDate] of [["MAYBANK", "2025-06-02"], ["MAYBANK", "2026-09-25"], ["SAVED", "2024-01-02"]]) {
      for (const basket of ["top-picks", "big-companies"] as const) getDb().insert(trackRecordEntries).values({ ticker, pickDate, basket, rank: 1, entryClose: 10, recordedAt: now }).run();
    }
    seedBar("2026-09-25", 20);
    seedBar("2026-09-26", 21);
    await importYahooPrices({ listedOnly: true, skipUniverseSeed: true, skipAlerts: true, range: "auto", refreshTrackRecordHistory: true, rateLimitMs: 0 });
    expect(vi.mocked(fetchYahooDailyBars).mock.calls).toEqual([
      ["MAYBANK.KL", { startDate: "2025-06-02" }],
      ["SAVED.KL", { startDate: "2024-01-02" }],
      ["UNSAVED.KL", "2y"],
    ]);
    const historical = getDb().select().from(priceBars).all().find((bar) => bar.barDate === "2026-09-25");
    expect(historical?.close).toBe(20);
    expect(historical?.adjClose).toBe(10.15);
  });

  it("uses ordinary ranges without saved entries", async () => {
    await importYahooPrices({ listedOnly: true, skipUniverseSeed: true, skipAlerts: true, range: "auto", refreshTrackRecordHistory: true, rateLimitMs: 0 });
    expect(vi.mocked(fetchYahooDailyBars).mock.calls).toEqual([["MAYBANK.KL", "2y"]]);
  });

  it("refreshes the comparison window's adjusted closes after a split without rewriting older closes", async () => {
    const history = Array.from({ length: 21 }, (_, i) => ({
      barDate: `2026-09-${String(i + 1).padStart(2, "0")}`,
      open: 5, high: 5, low: 5, close: 5, adjClose: 5, volume: 1000,
    }));
    for (const bar of history) seedBar(bar.barDate, 10);
    const split = { ...history[0], barDate: "2026-09-22", split: true } as const;
    vi.mocked(fetchYahooDailyBars)
      .mockResolvedValueOnce([history[20], split])
      .mockResolvedValueOnce([...history, split]);

    const report = await importYahooPrices({ onlyTicker: "MAYBANK", skipUniverseSeed: true, skipAlerts: true, range: "5d" });

    expect(report.succeeded).toEqual(["MAYBANK"]);
    expect(vi.mocked(fetchYahooDailyBars).mock.calls).toEqual([
      ["MAYBANK.KL", "5d"], ["MAYBANK.KL", { startDate: history[0].barDate }],
    ]);
    const bars = getDb().select().from(priceBars).all().sort((a, b) => b.barDate.localeCompare(a.barDate));
    expect(bars.at(-1)).toMatchObject({ close: 10, adjClose: 5 });
    expect(recentPriceDrop(bars)).toMatchObject({ drop: 0, highClose: 5, lastClose: 5 });
  });

  it("logs a saved-history failure, records provenance, and continues through rescore", async () => {
    getDb().insert(trackRecordEntries).values({ ticker: "MAYBANK", pickDate: "2025-06-02", basket: "top-picks", rank: 1, entryClose: 10, recordedAt: "2026-09-25" }).run();
    vi.mocked(fetchYahooDailyBars).mockRejectedValueOnce(new Error("history unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rescore = vi.fn();
    try {
      const result = await runDailyRefresh({
        importPrices: (options) => importYahooPrices({ ...options, skipUniverseSeed: true, rateLimitMs: 0 }),
        importFundamentals: async () => ({ kind: "fundamentals-yahoo", startedAt: "a", finishedAt: "b", attempted: 1, upserted: 0, inserted: 0, filled: 0, unchanged: 1, skippedHadFilings: 0, skippedOtherSource: 0, instrumentsUpdated: 0, instrumentsUnchanged: 1, instrumentsSkippedFresh: 1, instrumentsFetched: 0, failed: [] }),
        rescore,
      });
      expect(result.datasets.find((dataset) => dataset.dataset === "prices")?.failedCount).toBe(1);
      expect(rescore).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("history unavailable"));
      const provenance = getDb().select().from(refreshRuns).all().find((run) => run.dataset === "prices");
      expect(provenance?.metadataJson).toContain("history unavailable");
    } finally {
      log.mockRestore();
    }
  });

  it("manual/backfill default range remains 5y; market scan keeps 2y", async () => {
    await importYahooPrices({ onlyTicker: "MAYBANK", skipAlerts: true, rateLimitMs: 0 });
    expect(vi.mocked(fetchYahooDailyBars).mock.calls[0]?.[1]).toBe("5y");

    const scanSrc = readFileSync(join(process.cwd(), "src/market/scan.ts"), "utf8");
    expect(scanSrc).toMatch(/range:\s*"2y"/);
    expect(scanSrc).toMatch(/rateLimitMs:\s*200/);
  });

  it("preserves stored history, appends new sessions, and deletes nothing", async () => {
    seedBar("2025-06-02", 9.5);
    seedBar("2025-06-03", 9.6);
    const before = getDb()
      .select()
      .from(priceBars)
      .all()
      .map((b) => ({ barDate: b.barDate, close: b.close, retrievedAt: b.retrievedAt }));
    expect(before).toHaveLength(2);

    await importYahooPrices({
      onlyTicker: "MAYBANK",
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 0,
    });

    const after = getDb()
      .select()
      .from(priceBars)
      .all()
      .filter((b) => b.instrumentId === getDb().select().from(instruments).where(eq(instruments.ticker, "MAYBANK")).get()!.id);
    const byDate = Object.fromEntries(after.map((b) => [b.barDate, b]));
    expect(byDate["2025-06-02"]?.close).toBe(9.5);
    expect(byDate["2025-06-03"]?.close).toBe(9.6);
    expect(byDate["2025-06-02"]?.retrievedAt).toBe("2026-01-15T10:00:00.000Z");
    expect(byDate["2026-09-25"]?.close).toBe(10.15);
    expect(byDate["2026-09-26"]?.close).toBe(10.35);
    expect(after).toHaveLength(4);
    expect(vi.mocked(fetchYahooDailyBars).mock.calls[0]?.[1]).toBe("5d");
  });

  it("scoring methodology flags remain unchanged", () => {
    const config = loadScoringConfig();
    expect(config.concerns.apply_score_penalty).toBe(false);
  });
});
