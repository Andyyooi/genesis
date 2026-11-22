import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSqlite } from "@/db/client";
import { instruments, priceBars, scoreRuns, trackRecordEntries } from "@/db/schema";
import { loadTrackRecord } from "@/track-record/load";
import { recordTrackRecord } from "@/track-record/record";

const mocks = vi.hoisted(() => ({ scan: vi.fn(), picks: vi.fn() }));
vi.mock("@/market/scan", () => ({ loadLatestMarketScan: mocks.scan }));
vi.mock("@/opportunities/top-picks", () => ({ loadTopPicks: mocks.picks }));

const date = "2026-11-20";
const asOf = "2026-11-21T12:00:00.000Z";
const env = { ...process.env };
function reset() {
  const global = globalThis as { sqlite?: { close: () => void } };
  global.sqlite?.close();
  delete global.sqlite;
}
function seed(ticker: string, cap: number, close: number | null = 1.005, listed = true) {
  const db = getDb();
  const row = db.insert(instruments).values({ ticker, name: ticker, instrumentType: "COMMON_STOCK", listingStatus: listed ? "listed" : "inactive", createdAt: asOf, updatedAt: asOf }).returning().get();
  if (close !== null) db.insert(priceBars).values({ instrumentId: row.id, barDate: date, close, source: "yahoo", retrievedAt: asOf }).run();
  db.insert(scoreRuns).values({ instrumentId: row.id, asOf, configHash: "test", instrumentProfile: "default", categoryScoresJson: "[]", coverageJson: "{}", dataConfidence: "HIGH", evidenceJson: JSON.stringify({ scoredMetrics: [{ id: "market_cap", available: true, value: cap }] }), createdAt: asOf }).run();
  return row.id;
}
beforeEach(() => {
  reset();
  process.env.BURSA_SQLITE_PATH = ":memory:";
  process.env.BURSA_SNAPSHOT_READONLY = "0";
  process.env.VERCEL = "0";
  mocks.scan.mockReturnValue({ summary: { asOf }, rows: [{ lastTrade: date }] });
  mocks.picks.mockReturnValue({ picks: [{ ticker: "T0", selectionScore: 80 }] });
});
afterEach(() => { reset(); process.env = { ...env }; });

describe("track record recording", () => {
  it("selects 30 largest listed companies with exact-date prices and replaces the whole date", () => {
    for (let i = 0; i < 32; i++) seed(`T${i}`, i + 1);
    seed("INACTIVE", 9999, 1, false);
    seed("NO_CLOSE", 9998, null);
    expect(recordTrackRecord()).toBe(31);
    const rows = getDb().select().from(trackRecordEntries).all();
    expect(rows.find((row) => row.basket === "top-picks")?.entryClose).toBe(1.005);
    expect(rows.filter((row) => row.basket === "big-companies").map((row) => row.ticker)).toEqual(Array.from({ length: 30 }, (_, i) => `T${31 - i}`));
    mocks.picks.mockReturnValue({ picks: [{ ticker: "T1", selectionScore: 90 }] });
    recordTrackRecord();
    expect(getDb().select().from(trackRecordEntries).all()).toHaveLength(31);
    expect(loadTrackRecord().latestPicks.map((row) => row.ticker)).toEqual(["T1"]);
  });
  it("does nothing without a published scan or in read-only mode", () => {
    mocks.scan.mockReturnValue({ summary: null, rows: [] });
    expect(recordTrackRecord()).toBe(0);
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    expect(recordTrackRecord()).toBe(0);
  });
  it("rolls back replacement if insertion fails", () => {
    seed("T0", 1);
    recordTrackRecord();
    getSqlite().exec("CREATE TRIGGER fail_track BEFORE INSERT ON track_record_entries BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => recordTrackRecord()).toThrow("test failure");
    expect(getDb().select().from(trackRecordEntries).all()).toHaveLength(2);
  });
  it("does not substitute a different day's closing price", () => {
    const id = seed("T0", 1, null);
    getDb().insert(priceBars).values({ instrumentId: id, barDate: "2026-11-19", close: 2, source: "yahoo", retrievedAt: asOf }).run();
    expect(recordTrackRecord()).toBe(0);
    expect(loadTrackRecord().dates).toEqual([]);
  });
});

describe("track record returns", () => {
  it("has an empty summary without saved entries", () => {
    expect(loadTrackRecord().summary).toEqual({ count: 0, pickReturn: null, basketReturn: null, beatCount: 0, comparableCount: 0, excluded: 0 });
  });
  it("equal-weights returns, counts missing prices, and averages dates", () => {
    const a = seed("A", 1, 10);
    const b = seed("B", 2, 20);
    for (const [instrumentId, close] of [[a, 12], [b, 18]]) getDb().insert(priceBars).values({ instrumentId, barDate: "2026-11-23", close, source: "yahoo", retrievedAt: asOf }).run();
    getDb().insert(priceBars).values({ instrumentId: a, barDate: "2026-11-24", close: 999, source: "sample", retrievedAt: asOf }).run();
    const insert = (pickDate: string, basket: "top-picks" | "big-companies", ticker: string, entryClose: number) => getDb().insert(trackRecordEntries).values({ pickDate, basket, ticker, entryClose, rank: 1, recordedAt: asOf }).run();
    insert(date, "top-picks", "A", 10);
    insert(date, "top-picks", "B", 20);
    insert(date, "top-picks", "MISSING", 1);
    insert(date, "big-companies", "B", 20);
    insert("2026-11-19", "top-picks", "A", 12);
    insert("2026-11-19", "big-companies", "B", 18);
    const result = loadTrackRecord();
    expect(result.dates[0].picks.priceReturn).toBeCloseTo(0.05);
    expect(result.dates[0].basket.priceReturn).toBeCloseTo(-0.1);
    expect(result.dates[0].difference).toBeCloseTo(0.15);
    expect(result.summary.pickReturn).toBeCloseTo(0.025);
    expect(result.summary.basketReturn).toBeCloseTo(-0.05);
    expect(result.summary.beatCount).toBe(1);
    expect(result.summary.excluded).toBe(1);
  });
});
