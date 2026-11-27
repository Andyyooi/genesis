import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { SESSION_COOKIE, signSession } from "@/auth/session";
import { getSqlite, migrateSqliteSchema } from "@/db/client";
import { proxy } from "@/proxy";
import { readPriceHealth } from "@/refresh/data-health";

vi.mock("@/db/client", { spy: true });

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
  migrateSqliteSchema(sqlite);
  vi.mocked(getSqlite).mockReturnValue(sqlite);
  vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
  vi.stubEnv("VERCEL", "0");
});
afterEach(() => {
  sqlite.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function instrument(id: number, status = "listed") {
  sqlite.prepare(`
    INSERT INTO instruments (id, ticker, name, instrument_type, listing_status, created_at, updated_at)
    VALUES (?, ?, ?, 'COMMON_STOCK', ?, '2026-01-01', '2026-01-01')
  `).run(id, `STOCK${id}`, `Stock ${id}`, status);
}

function close(instrumentId: number, date: string, price: number | null = 1, source = "yahoo") {
  sqlite.prepare(`
    INSERT INTO price_bars (instrument_id, bar_date, close, source, retrieved_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(instrumentId, date, price, source, date);
}

describe("published price coverage", () => {
  it("counts only listed names with positive Yahoo closes on both latest sessions", () => {
    for (let id = 1; id <= 4; id++) instrument(id);
    instrument(5, "inactive");
    close(1, "2026-11-27");
    close(1, "2026-11-26");
    close(2, "2026-11-27");
    close(2, "2026-11-25");
    close(3, "2026-11-27", 0);
    close(3, "2026-11-26");
    close(3, "2026-11-27", 1, "csv");
    close(4, "2026-11-28", null);
    close(4, "2026-11-28", 1, "csv");
    close(5, "2026-11-28");
    close(1, "2026-11-29");
    expect(readPriceHealth(sqlite, "2026-11-28")).toEqual({
      asOfDate: "2026-11-27",
      previousPriceDate: "2026-11-26",
      freshPriceCount: 1,
      listedCount: 4,
      ageDays: 1,
      lowCoverage: true,
      stale: false,
    });
  });

  it("tolerates a weekend and a short holiday but warns after four calendar days", () => {
    for (let id = 1; id <= 10; id++) {
      instrument(id);
      close(id, "2026-11-27");
      if (id < 10) close(id, "2026-11-26");
    }
    expect(readPriceHealth(sqlite, "2026-12-01")).toMatchObject({ freshPriceCount: 9, lowCoverage: false, stale: false });
    expect(readPriceHealth(sqlite, "2026-12-02")).toMatchObject({ lowCoverage: false, stale: true });
  });

  it("does not count a single published session as two fresh closes", () => {
    instrument(1);
    close(1, "2026-11-27");
    expect(readPriceHealth(sqlite, "2026-11-27")).toMatchObject({ previousPriceDate: null, freshPriceCount: 0, lowCoverage: true });
  });
});

describe("health endpoint", () => {
  it("returns uncached degraded status when there are no prices", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      status: "degraded", asOfDate: null, snapshotBytes: null, freshPriceCount: 0, stale: true, lowCoverage: true,
    });
  });

  it("uses the current date in Malaysia and reports unreadable data without leaking details", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T16:01:00Z"));
    instrument(1);
    close(1, "2026-11-27");
    close(1, "2026-11-26");
    expect(await GET().json()).toMatchObject({ status: "ok", asOfDate: "2026-11-27" });
    vi.mocked(getSqlite).mockImplementation(() => { throw new Error("private path"); });
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", error: "Cannot read saved research data." });
  });

  it("keeps health behind the existing password gate", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    const url = "https://research.test/api/health";
    expect((await proxy(new NextRequest(url))).status).toBe(401);
    const cookie = `${SESSION_COOKIE}=${await signSession(process.env)}`;
    expect((await proxy(new NextRequest(url, { headers: { cookie } }))).status).toBe(200);
  });
});
