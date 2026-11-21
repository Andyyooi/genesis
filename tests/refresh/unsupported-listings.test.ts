import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { importYahooFundamentals } from "@/market/ingest-fundamentals-yahoo";

let directory: string;
afterEach(() => {
  const state = globalThis as { sqlite?: { close(): void } };
  state.sqlite?.close(); delete state.sqlite;
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it("skips unsupported / non-equity listings but still reports genuine equity misses", async () => {
  directory = mkdtempSync(join(tmpdir(), "genesis-unsupported-"));
  vi.stubEnv("BURSA_SQLITE_PATH", join(directory, "research.db"));
  vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0"); vi.stubEnv("VERCEL", "0");
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(instruments).values({ ticker: "ABFMY1", name: "ABF Malaysia Bond Index", instrumentType: "COMMON_STOCK", createdAt: now, updatedAt: now }).run();
  const provider = { id: "test", annualPeriods: vi.fn(async () => []) };
  expect(await importYahooFundamentals(provider, { rateLimitMs: 0 })).toMatchObject({ attempted: 0, failed: [] });
  expect(provider.annualPeriods).not.toHaveBeenCalled();
  db.insert(instruments).values({ ticker: "EQUITY", yahooTicker: "0001.KL", name: "Equity Berhad", instrumentType: "COMMON_STOCK", createdAt: now, updatedAt: now }).run();
  const report = await importYahooFundamentals(provider, { rateLimitMs: 0 });
  expect(report.attempted).toBe(1);
  expect(report.failed.map((r) => r.ticker)).toEqual(["EQUITY"]);
});
