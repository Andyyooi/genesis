import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, getSqlite } from "@/db/client";
import { financialPeriods, instruments, marketScanRuns, priceBars, scoreRuns } from "@/db/schema";
import { emptyLineItems } from "@/ingest/merge-line-items";
import { loadLatestMarketScan, rescoreListedMarket } from "@/market/scan";
import { rowMatchesList } from "@/opportunities/lists";
import { clearOpportunityScanCache, scanWatchlist } from "@/opportunities/scan";
import { scoreTicker } from "@/scoring/run-ticker";

const asOf = "2026-09-25T12:00:00.000Z";
let directory: string;
function close() {
  const global = globalThis as { sqlite?: { close(): void } };
  global.sqlite?.close();
  delete global.sqlite;
  clearOpportunityScanCache();
}
beforeEach(() => {
  close();
  directory = mkdtempSync(join(tmpdir(), "genesis-universe-test-"));
  vi.stubEnv("BURSA_SQLITE_PATH", join(directory, "research.db"));
  vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
  vi.stubEnv("VERCEL", "0");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(asOf));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in rescore"); }));
  for (const [ticker, eps] of [["MAYBANK", 1], ["CIMB", 2]] as const) {
    const db = getDb();
    const instrument = db.insert(instruments).values({ ticker, name: ticker, instrumentType: "COMMON_STOCK", sector: "Financial Services", industry: "Banks - Regional", watchlist: true, listingStatus: "listed", createdAt: asOf, updatedAt: asOf }).returning().get();
    db.insert(financialPeriods).values({ instrumentId: instrument.id, fiscalYear: 2025, fiscalQuarter: null, fiscalPeriod: "FY", periodEnd: "2025-12-31", statementType: "annual", actualOrEstimate: "actual", lineItemsJson: JSON.stringify({ ...emptyLineItems(), eps, revenue: 100, pat: eps * 10, equity: 100, totalAssets: 200, totalDebt: 20, cash: 10, shares: 10, dividendPerShare: 0.1 }), source: "test", retrievedAt: asOf }).run();
    for (let i = 0; i < 253; i++) db.insert(priceBars).values({ instrumentId: instrument.id, barDate: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 10, high: 10, low: 10, close: 10, adjClose: 10, volume: 20000, source: "test", retrievedAt: asOf }).run();
  }
});
afterEach(() => { close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });

describe("published universe scores", () => {
  it("does not present legacy anchor scans as current percentile scores", () => {
    getDb().insert(marketScanRuns).values({ asOf, createdAt: asOf, summaryJson: JSON.stringify({ kind: "market-scan", highlights: {} }) }).run();
    expect(loadLatestMarketScan()).toEqual({ summary: null, rows: [] });
    expect(scoreTicker("MAYBANK")?.result.researchScore).toBeNull();
  });
  it("network-free rescore publishes one score for market, company and recommendation readers", async () => {
    expect(scoreTicker("MAYBANK")?.result.researchScore).toBeNull();
    expect(scoreTicker("UNKNOWN")).toBeNull();
    rescoreListedMarket();
    const market = loadLatestMarketScan().rows.find((r) => r.ticker === "MAYBANK")!;
    const company = scoreTicker("MAYBANK", true)!;
    const opportunity = scanWatchlist().find((r) => r.ticker === "MAYBANK")!;
    expect(company.result.researchScore).not.toBeNull();
    expect(market.researchScore).toBe(company.result.researchScore);
    expect(opportunity.researchScore).toBe(company.result.researchScore);
    expect(market.eligible).toBe(true);
    expect(getDb().select().from(scoreRuns).all()).toHaveLength(2);
    getSqlite().prepare("UPDATE instruments SET warning_flag = 1 WHERE ticker = ?").run("MAYBANK");
    rescoreListedMarket();
    const excluded = scanWatchlist().find((r) => r.ticker === "MAYBANK")!;
    expect(excluded.result.eligibility?.eligible).toBe(false);
    expect(excluded.researchScore).toBe(company.result.researchScore);
    expect(rowMatchesList(excluded, "watchlist")).toBe(true);
    expect(rowMatchesList(excluded, "quality-value")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rolls back both score and market publications on a failed market write", async () => {
    rescoreListedMarket();
    getSqlite().exec("CREATE TRIGGER fail_scan BEFORE INSERT ON market_scan_rows BEGIN SELECT RAISE(ABORT, 'publication failure'); END");
    expect(() => rescoreListedMarket()).toThrow("publication failure");
    expect(getDb().select().from(scoreRuns).all()).toHaveLength(2);
    expect(getDb().select().from(marketScanRuns).all()).toHaveLength(1);
  });
});
