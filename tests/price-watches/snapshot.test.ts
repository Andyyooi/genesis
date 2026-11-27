import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { loadWatchCloses } from "@/price-watches/snapshot";

const getSqlite = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ getSqlite }));

describe("saved watch close selection", () => {
  it("takes the two latest usable Yahoo closes, not an intraday quote, invalid close or future date", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE price_bars (instrument_id INTEGER, bar_date TEXT, source TEXT, close REAL, retrieved_at TEXT);
        INSERT INTO price_bars VALUES
          (1, '2020-01-01', 'yahoo', 2, '2020-01-01T10:00:00Z'),
          (1, '2020-01-02', 'yahoo', 3, '2020-01-02T09:00:00Z'),
          (1, '2020-01-03', 'yahoo', 1, '2020-01-03T08:59:59Z'),
          (1, '2020-01-04', 'other', 1, '2020-01-04T10:00:00Z'),
          (1, '2020-01-05', 'yahoo', 0, '2020-01-05T10:00:00Z'),
          (2, '2020-01-06', 'yahoo', 1, '2020-01-06T10:00:00Z'),
          (1, '2099-01-01', 'yahoo', 1, '2099-01-01T10:00:00Z');
      `);
      getSqlite.mockReturnValue(db);
      expect(loadWatchCloses(1)).toEqual([
        { date: "2020-01-02", close: 3 },
        { date: "2020-01-01", close: 2 },
      ]);
    } finally {
      db.close();
    }
  });
});
