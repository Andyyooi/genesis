import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCliEntrypoint } from "@/cli/entrypoint";

const jobs = vi.hoisted(() => ({
  importYahooPrices: vi.fn(async () => ({ kind: "prices" })),
  importFundamentalsCsv: vi.fn(() => ({ kind: "fundamentals" })),
  importAnnouncementsCsv: vi.fn(() => ({ kind: "announcements" })),
  fillYahooAvailableAt: vi.fn(async () => ({ kind: "available-at" })),
  runMarketScan: vi.fn(async () => ({ kind: "scan" })),
  rescoreListedMarket: vi.fn(() => ({ kind: "rescore" })),
  importYahooFundamentals: vi.fn(async () => ({
    failed: [],
    attempted: 0,
  })),
  buildFundamentalsQualityReport: vi.fn(() => ({ kind: "quality" })),
  persistFundamentalsQualityReport: vi.fn((report: unknown) => report),
  refreshAlertsForUniverse: vi.fn(() => ({ refreshed: 0 })),
  scoreTicker: vi.fn(() => ({
    ticker: "MAYBANK",
    result: {
      profile: "default",
      configHash: "x",
      researchScore: 1,
      valuationScore: 1,
      dataConfidence: "LOW",
      dataCoverage: 1,
      categories: [],
      concerns: [],
      notes: [],
    },
  })),
  loadInstrumentSnapshots: vi.fn(() => ({
    instrument: {
      ticker: "MAYBANK",
      name: "Malayan Banking Berhad",
      instrumentType: "COMMON_STOCK",
    },
    periods: [],
    bars: [],
  })),
  ingestPhase16Events: vi.fn(async () => ({ inserted: 0 })),
  assignResearchProfiles: vi.fn(() => ({ updated: 0 })),
  runDailyRefresh: vi.fn(async () => ({ overallStatus: "SUCCESS" })),
  formatDailyRefreshSummary: vi.fn(() => "summary"),
  getSqlite: vi.fn(() => {
    throw new Error("CLI test blocked getSqlite");
  }),
  getDb: vi.fn(() => {
    throw new Error("CLI test blocked getDb");
  }),
}));

vi.mock("@/ingest/import-prices", () => ({ importYahooPrices: jobs.importYahooPrices }));
vi.mock("@/ingest/import-fundamentals", () => ({ importFundamentalsCsv: jobs.importFundamentalsCsv }));
vi.mock("@/ingest/import-announcements", () => ({ importAnnouncementsCsv: jobs.importAnnouncementsCsv }));
vi.mock("@/ingest/fill-available-at", () => ({ fillYahooAvailableAt: jobs.fillYahooAvailableAt }));
vi.mock("@/market/scan", () => ({
  runMarketScan: jobs.runMarketScan,
  rescoreListedMarket: jobs.rescoreListedMarket,
}));
vi.mock("@/market/ingest-fundamentals-yahoo", () => ({
  importYahooFundamentals: jobs.importYahooFundamentals,
}));
vi.mock("@/market/fundamentals-quality", () => ({
  buildFundamentalsQualityReport: jobs.buildFundamentalsQualityReport,
  persistFundamentalsQualityReport: jobs.persistFundamentalsQualityReport,
}));
vi.mock("@/alerts/refresh", () => ({ refreshAlertsForUniverse: jobs.refreshAlertsForUniverse }));
vi.mock("@/scoring/run-ticker", () => ({ scoreTicker: jobs.scoreTicker }));
vi.mock("@/db/queries", () => ({ loadInstrumentSnapshots: jobs.loadInstrumentSnapshots }));
vi.mock("@/events/ingest", () => ({
  ingestPhase16Events: jobs.ingestPhase16Events,
  PHASE16_EVENT_TICKERS: ["MAYBANK"],
}));
vi.mock("@/research/assign-profiles", () => ({ assignResearchProfiles: jobs.assignResearchProfiles }));
vi.mock("@/refresh/daily", () => ({
  runDailyRefresh: jobs.runDailyRefresh,
  formatDailyRefreshSummary: jobs.formatDailyRefreshSummary,
}));
vi.mock("@/db/client", () => ({
  getSqlite: jobs.getSqlite,
  getDb: jobs.getDb,
  migrateSqliteSchema: () => {
    throw new Error("CLI test blocked migrateSqliteSchema");
  },
}));

const originalArgv = process.argv.slice();
const originalExitCode = process.exitCode;
const cliFiles = [
  "src/ingest/cli.ts",
  "src/market/cli.ts",
  "src/alerts/cli.ts",
  "src/scoring/cli.ts",
  "src/metrics/cli.ts",
  "src/events/cli.ts",
  "src/research/cli.ts",
  "src/refresh/cli.ts",
  "scripts/pack-snapshot.ts",
  "scripts/snapshot-report.ts",
  "scripts/validate-fair-value-one.ts",
] as const;

function cliPath(file: string) {
  return realpathSync(resolve(file));
}

async function importModule(specifier: string, entryFile?: string) {
  vi.resetModules();
  process.argv = entryFile ? [originalArgv[0] ?? "node", cliPath(entryFile)] : originalArgv.slice();
  return import(specifier);
}

async function settle() {
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
}

describe("CLI entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = originalArgv.slice();
    process.exitCode = undefined;
    delete process.env.BURSA_SQLITE_PATH;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    delete process.env.VERCEL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    jobs.importYahooPrices.mockResolvedValue({ kind: "prices" });
    jobs.ingestPhase16Events.mockResolvedValue({ inserted: 0 });
    jobs.refreshAlertsForUniverse.mockReturnValue({ refreshed: 0 });
    jobs.runDailyRefresh.mockResolvedValue({ overallStatus: "SUCCESS" });
    jobs.getSqlite.mockImplementation(() => {
      throw new Error("CLI test blocked getSqlite");
    });
    jobs.getDb.mockImplementation(() => {
      throw new Error("CLI test blocked getDb");
    });
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("recognises each CLI file as an entrypoint only when that file is launched", () => {
    for (const file of cliFiles) {
      const filePath = cliPath(file);
      const moduleUrl = pathToFileURL(filePath).href;
      expect(isCliEntrypoint(moduleUrl, filePath), file).toBe(true);
      expect(isCliEntrypoint(moduleUrl, originalArgv[1]), file).toBe(false);
    }
    expect(isCliEntrypoint(import.meta.url)).toBe(false);
  });

  it("imports every CLI without starting its job", async () => {
    await importModule("@/ingest/cli");
    await importModule("@/market/cli");
    await importModule("@/alerts/cli");
    await importModule("@/scoring/cli");
    await importModule("@/metrics/cli");
    await importModule("@/events/cli");
    await importModule("@/research/cli");
    await importModule("@/refresh/cli");
    await importModule(pathToFileURL(cliPath("scripts/pack-snapshot.ts")).href);
    await importModule(pathToFileURL(cliPath("scripts/snapshot-report.ts")).href);
    await importModule(pathToFileURL(cliPath("scripts/validate-fair-value-one.ts")).href);
    await settle();

    expect(jobs.importYahooPrices).not.toHaveBeenCalled();
    expect(jobs.importFundamentalsCsv).not.toHaveBeenCalled();
    expect(jobs.importAnnouncementsCsv).not.toHaveBeenCalled();
    expect(jobs.fillYahooAvailableAt).not.toHaveBeenCalled();
    expect(jobs.runMarketScan).not.toHaveBeenCalled();
    expect(jobs.rescoreListedMarket).not.toHaveBeenCalled();
    expect(jobs.importYahooFundamentals).not.toHaveBeenCalled();
    expect(jobs.refreshAlertsForUniverse).not.toHaveBeenCalled();
    expect(jobs.scoreTicker).not.toHaveBeenCalled();
    expect(jobs.loadInstrumentSnapshots).not.toHaveBeenCalled();
    expect(jobs.ingestPhase16Events).not.toHaveBeenCalled();
    expect(jobs.assignResearchProfiles).not.toHaveBeenCalled();
    expect(jobs.runDailyRefresh).not.toHaveBeenCalled();
    expect(jobs.getSqlite).not.toHaveBeenCalled();
    expect(jobs.getDb).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("runs each directly launched CLI command once", async () => {
    await importModule("@/ingest/cli", "src/ingest/cli.ts");
    await settle();
    expect(jobs.importFundamentalsCsv).toHaveBeenCalledTimes(1);
    expect(jobs.importAnnouncementsCsv).toHaveBeenCalledTimes(1);
    expect(jobs.importYahooPrices).toHaveBeenCalledTimes(1);
    expect(jobs.fillYahooAvailableAt).not.toHaveBeenCalled();

    await importModule("@/ingest/cli");
    await settle();
    expect(jobs.importYahooPrices).toHaveBeenCalledTimes(1);

    await importModule("@/market/cli", "src/market/cli.ts");
    await settle();
    expect(jobs.runMarketScan).toHaveBeenCalledTimes(1);
    expect(jobs.rescoreListedMarket).not.toHaveBeenCalled();
    expect(jobs.importYahooFundamentals).not.toHaveBeenCalled();

    await importModule("@/alerts/cli", "src/alerts/cli.ts");
    expect(jobs.refreshAlertsForUniverse).toHaveBeenCalledTimes(1);

    await importModule("@/scoring/cli", "src/scoring/cli.ts");
    expect(jobs.scoreTicker).toHaveBeenCalledTimes(1);
    expect(jobs.scoreTicker).toHaveBeenCalledWith("MAYBANK", true);

    await importModule("@/metrics/cli", "src/metrics/cli.ts");
    expect(jobs.loadInstrumentSnapshots).toHaveBeenCalledTimes(1);
    expect(jobs.loadInstrumentSnapshots).toHaveBeenCalledWith("MAYBANK");

    await importModule("@/events/cli", "src/events/cli.ts");
    await settle();
    expect(jobs.ingestPhase16Events).toHaveBeenCalledTimes(1);

    await importModule("@/research/cli", "src/research/cli.ts");
    expect(jobs.assignResearchProfiles).toHaveBeenCalledTimes(1);

    await importModule("@/refresh/cli", "src/refresh/cli.ts");
    await settle();
    expect(jobs.runDailyRefresh).toHaveBeenCalledTimes(1);

    await importModule(pathToFileURL(cliPath("scripts/pack-snapshot.ts")).href, "scripts/pack-snapshot.ts");
    await settle();
    expect(jobs.getSqlite).not.toHaveBeenCalled();
    expect(jobs.getDb).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;

    await importModule(
      pathToFileURL(cliPath("scripts/validate-fair-value-one.ts")).href,
      "scripts/validate-fair-value-one.ts",
    );
    await settle();
    expect(jobs.getSqlite).not.toHaveBeenCalled();
    expect(jobs.getDb).not.toHaveBeenCalled();
    const errors = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(errors.some((line) => line.includes("--ticker"))).toBe(true);
  });

  it("keeps direct-invocation errors instead of hiding them", async () => {
    jobs.importYahooPrices.mockRejectedValue(new Error("prices broke"));
    await importModule("@/ingest/cli", "src/ingest/cli.ts");
    await settle();
    expect(jobs.importYahooPrices).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error).mock.calls.map((call) => String(call[0]))).toContain("prices broke");

    process.exitCode = undefined;
    jobs.refreshAlertsForUniverse.mockImplementation(() => {
      throw new Error("alerts broke");
    });
    await expect(importModule("@/alerts/cli", "src/alerts/cli.ts")).rejects.toThrow("alerts broke");
    expect(jobs.refreshAlertsForUniverse).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();

    jobs.ingestPhase16Events.mockRejectedValue(new Error("events broke"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await importModule("@/events/cli", "src/events/cli.ts");
    await settle();
    expect(jobs.ingestPhase16Events).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(expect.objectContaining({ message: "events broke" }));
  });
});
