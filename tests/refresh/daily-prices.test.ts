import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb, getSqlite } from "@/db/client";
import { instruments, priceBars } from "@/db/schema";
import { importYahooPrices } from "@/ingest/import-prices";
import { runDailyRefresh } from "@/refresh/daily";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
let tempDir = "";

vi.mock("@/ingest/providers/yahoo-prices", () => ({
  fetchYahooDailyBars: vi.fn(async (_ticker: string, _range: string) => [
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
  try {
    getSqlite().close();
  } catch {
    /* ignore */
  }
  const g = globalThis as { sqlite?: unknown };
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

  it("daily refresh uses range=5d and rateLimitMs=100", async () => {
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
      range: "5d",
      rateLimitMs: 100,
    });
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
