import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb, getSqlite } from "@/db/client";
import { financialPeriods, instruments, priceBars } from "@/db/schema";
import { emptyLineItems } from "@/ingest/merge-line-items";
import { importYahooFundamentals } from "@/market/ingest-fundamentals-yahoo";
import type { FundamentalPeriodDraft, FundamentalProvider } from "@/providers/types";
import { runDailyRefresh } from "@/refresh/daily";
import {
  DAILY_FUNDAMENTALS_RECHECK_DAYS,
  evaluateFundamentalsFreshness,
  utcCalendarDaysBetween,
} from "@/refresh/fundamentals-freshness";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
let tempDir = "";

function resetDb() {
  try {
    getSqlite().close();
  } catch {
    /* ignore */
  }
  const g = globalThis as { sqlite?: unknown };
  delete g.sqlite;
}

function seedInstrument(ticker: string, over: Partial<{ name: string }> = {}) {
  const now = new Date().toISOString();
  getDb()
    .insert(instruments)
    .values({
      ticker,
      bursaCode: "1155",
      yahooTicker: `${ticker}.KL`,
      name: over.name ?? `${ticker} Test`,
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

function seedYahooAnnual(
  ticker: string,
  args: {
    periodEnd: string;
    retrievedAt: string;
    lineItems: Record<string, number | null>;
  },
) {
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get()!;
  getDb()
    .insert(financialPeriods)
    .values({
      instrumentId: instrument.id,
      fiscalYear: Number(args.periodEnd.slice(0, 4)),
      fiscalQuarter: null,
      periodEnd: args.periodEnd,
      fiscalPeriod: `FY${args.periodEnd.slice(0, 4)}`,
      availableAt: null,
      filingDate: null,
      availableAtSource: null,
      retrievedAt: args.retrievedAt,
      statementType: "annual",
      source: "yahoo",
      actualOrEstimate: "actual",
      lineItemsJson: JSON.stringify({ ...emptyLineItems(), ...args.lineItems }),
    })
    .run();
}

function draftPeriod(periodEnd: string, over: Partial<FundamentalPeriodDraft> = {}): FundamentalPeriodDraft {
  return {
    periodEnd,
    fiscalYear: Number(periodEnd.slice(0, 4)),
    fiscalQuarter: null,
    fiscalPeriod: `FY${periodEnd.slice(0, 4)}`,
    statementType: "annual",
    source: "yahoo-timeseries",
    availableAt: null,
    filingDate: null,
    availableAtSource: null,
    actualOrEstimate: "actual",
    lineItems: {
      ...emptyLineItems(),
      revenue: 2e9,
      pat: 2e8,
      equity: 5e9,
      ...over.lineItems,
    },
    ...over,
  };
}

function countingProvider(periodsBySymbol: Record<string, FundamentalPeriodDraft[]>): FundamentalProvider & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    id: "test-counting",
    calls,
    async annualPeriods(yahooTicker: string) {
      calls.push(yahooTicker);
      return periodsBySymbol[yahooTicker] ?? periodsBySymbol["*"] ?? [];
    },
  };
}

describe("evaluateFundamentalsFreshness", () => {
  it("requires refresh when there are no Yahoo annuals", () => {
    const d = evaluateFundamentalsFreshness({
      yahooAnnuals: [],
      asOf: new Date("2026-09-26T00:00:00.000Z"),
    });
    expect(d.needsRefresh).toBe(true);
    expect(d.reason).toBe("no_yahoo_annuals");
  });

  it("requires refresh when latest annual is incomplete", () => {
    const d = evaluateFundamentalsFreshness({
      asOf: new Date("2026-09-26T00:00:00.000Z"),
      yahooAnnuals: [
        {
          periodEnd: "2024-12-31",
          retrievedAt: "2026-09-25T00:00:00.000Z",
          lineItemsJson: JSON.stringify({ revenue: 1, pat: null, equity: null }),
        },
      ],
    });
    expect(d.needsRefresh).toBe(true);
    expect(d.reason).toBe("incomplete_latest");
  });

  it("skips when complete and within recheck window", () => {
    const d = evaluateFundamentalsFreshness({
      asOf: new Date("2026-09-26T00:00:00.000Z"),
      recheckAfterDays: 14,
      yahooAnnuals: [
        {
          periodEnd: "2024-12-31",
          retrievedAt: "2026-09-20T12:00:00.000Z",
          lineItemsJson: JSON.stringify({ revenue: 1, pat: 1, equity: 1 }),
        },
      ],
    });
    expect(d.needsRefresh).toBe(false);
    expect(d.reason).toBe("fresh_complete");
    expect(d.daysSinceRetrieved).toBe(6);
  });

  it("requires refresh when retrieved_at is at/past the recheck threshold", () => {
    const d = evaluateFundamentalsFreshness({
      asOf: new Date("2026-09-26T00:00:00.000Z"),
      recheckAfterDays: 14,
      yahooAnnuals: [
        {
          periodEnd: "2024-12-31",
          retrievedAt: "2026-09-12T00:00:00.000Z",
          lineItemsJson: JSON.stringify({ revenue: 1, pat: 1, equity: 1 }),
        },
      ],
    });
    expect(d.needsRefresh).toBe(true);
    expect(d.reason).toBe("recheck_due");
    expect(utcCalendarDaysBetween("2026-09-12T00:00:00.000Z", new Date("2026-09-26T00:00:00.000Z"))).toBe(14);
    expect(DAILY_FUNDAMENTALS_RECHECK_DAYS).toBe(14);
  });
});

describe("importYahooFundamentals freshness gate", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-fund-gate-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetDb();
    getDb();
    seedInstrument("MAYBANK");
  });

  afterEach(() => {
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  });

  it("does not call Yahoo when fundamentals are fresh and complete", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-24T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const provider = countingProvider({
      "*": [draftPeriod("2025-12-31")],
    });
    const before = getDb().select().from(financialPeriods).all();
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z"), recheckAfterDays: 14 },
    });
    expect(provider.calls).toEqual([]);
    expect(report.instrumentsSkippedFresh).toBe(1);
    expect(report.instrumentsFetched).toBe(0);
    expect(report.instrumentsUnchanged).toBe(1);
    expect(getDb().select().from(financialPeriods).all()).toEqual(before);
  });

  it("calls Yahoo when fundamentals are past the refresh threshold", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-01T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const provider = countingProvider({
      "MAYBANK.KL": [draftPeriod("2024-12-31")],
    });
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z"), recheckAfterDays: 14 },
    });
    expect(provider.calls).toContain("MAYBANK.KL");
    expect(report.instrumentsSkippedFresh).toBe(0);
    expect(report.instrumentsFetched).toBe(1);
  });

  it("calls Yahoo when there are no existing fundamentals", async () => {
    const provider = countingProvider({
      "MAYBANK.KL": [draftPeriod("2024-12-31")],
    });
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z") },
    });
    expect(provider.calls.length).toBeGreaterThan(0);
    expect(report.instrumentsUpdated).toBe(1);
    expect(report.inserted).toBe(1);
  });

  it("calls Yahoo when existing fundamentals are incomplete", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-25T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: null, equity: null },
    });
    const provider = countingProvider({
      "MAYBANK.KL": [
        draftPeriod("2024-12-31", {
          lineItems: { ...emptyLineItems(), revenue: 1e9, pat: 1e8, equity: 5e9 },
        }),
      ],
    });
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z") },
    });
    expect(provider.calls).toContain("MAYBANK.KL");
    expect(report.filled).toBeGreaterThan(0);
  });

  it("preserves existing data when Yahoo is unavailable", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-01T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const before = getDb().select().from(financialPeriods).all()[0]!;
    const provider: FundamentalProvider = {
      id: "boom",
      async annualPeriods() {
        throw new Error("Yahoo down");
      },
    };
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z") },
    });
    expect(report.failed).toHaveLength(1);
    const after = getDb().select().from(financialPeriods).all()[0]!;
    expect(after.lineItemsJson).toBe(before.lineItemsJson);
    expect(after.periodEnd).toBe(before.periodEnd);
    expect(after.retrievedAt).toBe(before.retrievedAt);
  });

  it("persists a new annual period when Yahoo returns one", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2023-12-31",
      retrievedAt: "2026-09-01T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const provider = countingProvider({
      "MAYBANK.KL": [
        draftPeriod("2023-12-31"),
        draftPeriod("2024-12-31", {
          lineItems: { ...emptyLineItems(), revenue: 1.1e9, pat: 1.1e8, equity: 5.5e9 },
        }),
      ],
    });
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z") },
    });
    expect(report.inserted).toBe(1);
    const ends = getDb()
      .select()
      .from(financialPeriods)
      .all()
      .map((r) => r.periodEnd)
      .sort();
    expect(ends).toEqual(["2023-12-31", "2024-12-31"]);
  });

  it("leaves existing rows unchanged when Yahoo returns no new data", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-01T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const before = getDb().select().from(financialPeriods).all()[0]!;
    const provider = countingProvider({
      "MAYBANK.KL": [
        draftPeriod("2024-12-31", {
          lineItems: { ...emptyLineItems(), revenue: 1e9, pat: 1e8, equity: 5e9 },
        }),
      ],
    });
    const report = await importYahooFundamentals(provider, {
      freshnessGate: { asOf: new Date("2026-09-26T00:00:00.000Z") },
    });
    expect(report.unchanged).toBe(1);
    expect(report.inserted).toBe(0);
    expect(report.filled).toBe(0);
    const after = getDb().select().from(financialPeriods).all()[0]!;
    expect(after.lineItemsJson).toBe(before.lineItemsJson);
    // retrieved_at advances so the daily gate will skip until the next recheck window
    expect(after.retrievedAt).not.toBe(before.retrievedAt);
  });

  it("without freshnessGate still fetches (manual/backfill path)", async () => {
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-25T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
    const provider = countingProvider({
      "MAYBANK.KL": [draftPeriod("2024-12-31")],
    });
    await importYahooFundamentals(provider);
    expect(provider.calls).toContain("MAYBANK.KL");
  });
});

describe("daily refresh wires freshness gate without changing prices/scoring rules", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-daily-gate-"));
    process.env.BURSA_SQLITE_PATH = join(tempDir, "test.db");
    delete process.env.VERCEL;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    resetDb();
    getDb();
    seedInstrument("MAYBANK");
    getDb()
      .insert(priceBars)
      .values({
        instrumentId: 1,
        barDate: "2026-09-23",
        open: 10,
        high: 10,
        low: 10,
        close: 10.32,
        volume: 1000,
        adjClose: 10.32,
        asOf: "2026-09-23T16:00:00+08:00",
        source: "yahoo",
        adjusted: true,
        retrievedAt: "2026-09-23T10:00:00.000Z",
      })
      .run();
    seedYahooAnnual("MAYBANK", {
      periodEnd: "2024-12-31",
      retrievedAt: "2026-09-24T10:00:00.000Z",
      lineItems: { revenue: 1e9, pat: 1e8, equity: 5e9 },
    });
  });

  afterEach(() => {
    resetDb();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  });

  it("passes freshnessGate to fundamentals and unchanged price ingest options", async () => {
    const priceOpts: unknown[] = [];
    const fundOpts: unknown[] = [];
    const summary = await runDailyRefresh({
      importPrices: async (opts) => {
        priceOpts.push(opts);
        return {
          kind: "prices",
          startedAt: "a",
          finishedAt: "b",
          succeeded: ["MAYBANK"],
          failed: [],
          barsUpserted: 1,
        };
      },
      importFundamentals: async (opts) => {
        fundOpts.push(opts);
        return {
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
        };
      },
      rescore: () => ({ kind: "ok" }),
      now: () => new Date("2026-09-26T10:00:00.000Z"),
    });
    expect(priceOpts[0]).toMatchObject({
      listedOnly: true,
      skipAlerts: true,
      range: "1mo",
      rateLimitMs: 200,
    });
    expect(fundOpts[0]).toMatchObject({
      freshnessGate: {
        recheckAfterDays: DAILY_FUNDAMENTALS_RECHECK_DAYS,
      },
    });
    expect(summary.datasets.find((d) => d.dataset === "fundamentals")?.metadata).toMatchObject({
      instrumentsSkippedFresh: 1,
      instrumentsFetched: 0,
      recheckAfterDays: 14,
    });
    expect(getDb().select().from(priceBars).all()[0]!.close).toBe(10.32);
  });

  it("keeps scoring methodology flags unchanged", () => {
    const config = loadScoringConfig();
    expect(config.concerns.apply_score_penalty).toBe(false);
  });
});
