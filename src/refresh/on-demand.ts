import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { instruments, priceBars, refreshRuns, type RefreshStatus } from "@/db/schema";
import { importYahooPrices, type PriceIngestOptions } from "@/ingest/import-prices";
import type { PricesImportReport } from "@/ingest/types";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import {
  importYahooFundamentals,
  type YahooFundamentalsImportOptions,
  type YahooFundamentalsReport,
} from "@/market/ingest-fundamentals-yahoo";
import { fairValueRefreshOutcome, refreshFairValueUniverse, type FairValueRefreshReport } from "@/refresh/fair-value";
import { DAILY_FUNDAMENTALS_RECHECK_DAYS } from "@/refresh/fundamentals-freshness";
import { persistDatasetRefresh } from "@/refresh/persist";
import type { DatasetRefreshResult } from "@/refresh/types";
import { scoreTicker } from "@/scoring/run-ticker";

const inFlight = new Set<string>();
let watchlistActive = false;

export const PRICE_CADENCE = "end-of-day" as const;

export type RefreshCategoryId =
  | "prices"
  | "fundamentals"
  | "announcements"
  | "events"
  | "news"
  | "scores"
  | "fairValue";

export type OnDemandOverall =
  | "SUCCESS"
  | "PARTIAL"
  | "UNCHANGED"
  | "SOURCE_FAILED"
  | "REFUSED"
  | "ALREADY_RUNNING";

export type RefreshCategoryReport = {
  id: RefreshCategoryId;
  status: RefreshStatus | "NOT_RUN";
  source: string;
  attempted: number;
  succeeded: number;
  failed: number;
  updatedThisRun: boolean;
  lastSuccessfulAt: string | null;
  detail: string | null;
};

export type RefreshAndResearchReport = {
  kind: "refresh-and-research";
  scope: "instrument";
  ticker: string;
  startedAt: string;
  completedAt: string;
  durable: boolean;
  persistence: "local-sqlite" | "refused-read-only-snapshot" | "not-written";
  overall: OnDemandOverall;
  market: {
    source: "yahoo";
    cadence: typeof PRICE_CADENCE;
    realtime: false;
    previousDate: string | null;
    latestDate: string | null;
    updatedThisRun: boolean;
  };
  instruments: {
    attempted: number;
    priceSucceeded: number;
    priceFailed: number;
    fundamentalsSucceeded: number;
    fundamentalsFailed: number;
  };
  categories: Record<RefreshCategoryId, RefreshCategoryReport>;
  calculations: {
    scores: boolean;
    fairValue: boolean;
  };
  research: {
    ranAt: string | null;
    priceUsed: number | null;
    priceDateUsed: string | null;
    researchScore: number | null;
  };
  notes: string[];
};

type ScoredTicker = {
  metrics: { id: string; value: number | null; period: string | null }[];
  result: { asOf: string; researchScore: number | null };
};

export type RefreshAndResearchDeps = {
  now?: () => Date;
  readPriceDate?: (ticker: string) => string | null;
  importPrices?: (options: PriceIngestOptions) => Promise<PricesImportReport>;
  importFundamentals?: (options: YahooFundamentalsImportOptions) => Promise<YahooFundamentalsReport>;
  score?: (ticker: string) => ScoredTicker | null;
  fairValue?: (args: { asOf: string; onlyTicker: string }) => FairValueRefreshReport;
};

const EVENTS_DETAIL =
  "No production structured-events provider enabled. Existing events preserved. See docs/phase18-source-strategy.md.";
const NEWS_DETAIL =
  "No general-news provider configured. Absence of news is not neutral tone. Existing rows preserved.";
const ANNOUNCEMENTS_DETAIL =
  "Announcements stay on CSV ingest. This action does not fetch a live announcement feed.";

export function resetRefreshAndResearchLockForTests() {
  inFlight.clear();
  watchlistActive = false;
}

export function markWatchlistRefreshActive(active: boolean) {
  watchlistActive = active;
}

export function refreshInFlightCount() {
  return inFlight.size;
}

export function claimRefreshTickers(tickers: readonly string[]) {
  for (const ticker of tickers) inFlight.add(ticker);
}

export function releaseRefreshTickers(tickers: readonly string[]) {
  for (const ticker of tickers) inFlight.delete(ticker);
}

export function loadOnDemandCategoryStatus(ticker: string): Record<RefreshCategoryId, RefreshCategoryReport | null> {
  const symbol = ticker.trim().toUpperCase();
  const rows = getDb().select().from(refreshRuns).orderBy(desc(refreshRuns.id)).all();
  const found: Partial<Record<RefreshCategoryId, RefreshCategoryReport>> = {};
  for (const row of rows) {
    const metadata = parseMetadata(row.metadataJson);
    if (metadata.ticker !== symbol || metadata.kind !== "refresh-and-research") continue;
    const id = categoryIdFromDataset(row.dataset);
    if (!id || found[id]) continue;
    found[id] = {
      id,
      status: row.status as RefreshStatus,
      source: row.source,
      attempted: row.attemptedCount,
      succeeded: row.updatedCount + row.unchangedCount,
      failed: row.failedCount,
      updatedThisRun: metadata.updatedThisRun === true,
      lastSuccessfulAt: row.lastSuccessfulAt,
      detail: row.errorSummary,
    };
  }
  return {
    prices: found.prices ?? null,
    fundamentals: found.fundamentals ?? null,
    announcements: null,
    events: found.events ?? null,
    news: found.news ?? null,
    scores: found.scores ?? null,
    fairValue: found.fairValue ?? null,
  };
}

export async function runRefreshAndResearch(
  args: { ticker: string; knownMarketPriceDate?: string | null; joined?: boolean },
  deps: RefreshAndResearchDeps = {},
): Promise<RefreshAndResearchReport> {
  const symbol = args.ticker.trim().toUpperCase();
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const readPriceDate = deps.readPriceDate ?? latestStoredPriceDate;

  if (refuseSnapshotWrites("refresh-and-research")) {
    const stored = safePriceDate(readPriceDate, symbol) ?? args.knownMarketPriceDate ?? null;
    return finish({
      ticker: symbol,
      startedAt,
      completedAt: now().toISOString(),
      durable: false,
      persistence: "refused-read-only-snapshot",
      overall: "REFUSED",
      marketDate: stored,
      previousDate: stored,
      priceUpdated: false,
      categories: notRunCategories(stored),
      research: emptyResearch(),
      notes: [
        "This process uses a read-only SQLite snapshot. Refresh & Research did not fetch or save anything.",
        "The deployed app cannot durably store a new price. Local SQLite is the writable path.",
        "Yahoo prices are end-of-day daily bars, not a live quote.",
      ],
    });
  }

  if (!args.joined && watchlistActive) {
    return finish({
      ticker: symbol,
      startedAt,
      completedAt: now().toISOString(),
      durable: false,
      persistence: "not-written",
      overall: "ALREADY_RUNNING",
      marketDate: null,
      previousDate: null,
      priceUpdated: false,
      categories: notRunCategories(null),
      research: emptyResearch(),
      notes: ["A watchlist Refresh & Research is already running. This instrument was not fetched again."],
    });
  }

  if (!args.joined && (!symbol || inFlight.has(symbol))) {
    return finish({
      ticker: symbol,
      startedAt,
      completedAt: now().toISOString(),
      durable: false,
      persistence: "not-written",
      overall: symbol ? "ALREADY_RUNNING" : "SOURCE_FAILED",
      marketDate: null,
      previousDate: null,
      priceUpdated: false,
      categories: notRunCategories(null),
      research: emptyResearch(),
      notes: [
        symbol
          ? "A Refresh & Research run for this instrument is already in progress. This request did not start another one."
          : "A ticker is required.",
      ],
    });
  }

  if (!args.joined) inFlight.add(symbol);
  try {
    const previousDate = safePriceDate(readPriceDate, symbol);
    const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, symbol)).get();
    if (!instrument || instrument.listingStatus === "inactive") {
      return finish({
        ticker: symbol,
        startedAt,
        completedAt: now().toISOString(),
        durable: false,
        persistence: "not-written",
        overall: "SOURCE_FAILED",
        marketDate: previousDate,
        previousDate,
        priceUpdated: false,
        categories: notRunCategories(previousDate),
        research: emptyResearch(),
        notes: [`${symbol || "Ticker"} is not an active listed instrument. Nothing was fetched.`],
      });
    }

    const runId = `refresh-research-${symbol}-${randomUUID()}`;
    const categories = notRunCategories(previousDate);

    const prices = await runPrices(runId, symbol, previousDate, readPriceDate, now, deps);
    categories.prices = prices.category;
    const latestDate = prices.latestDate;

    const fundamentals = await runFundamentals(runId, symbol, latestDate, now, deps);
    categories.fundamentals = fundamentals;

    const stamp = now().toISOString();
    categories.announcements = category({
      id: "announcements",
      status: "NO_SOURCE",
      source: "csv",
      attempted: 0,
      succeeded: 0,
      failed: 0,
      updatedThisRun: false,
      lastSuccessfulAt: null,
      detail: ANNOUNCEMENTS_DETAIL,
    });
    categories.events = persistQuiet(runId, symbol, "events", "bursa-live-unavailable", stamp, latestDate, EVENTS_DETAIL);
    categories.news = persistQuiet(runId, symbol, "news", "none", stamp, latestDate, NEWS_DETAIL);

    const scored = runScores(runId, symbol, latestDate, now, deps);
    categories.scores = scored.category;
    const fair = runFairValue(runId, symbol, scored.research.ranAt ?? stamp, latestDate, now, deps, scored.category.status !== "SOURCE_FAILED");
    categories.fairValue = fair;

    const overall = overallStatus(categories);
    const notes = [
      "Yahoo prices are end-of-day daily bars, not a live quote.",
      "Events, news, and announcements have no production feed on this action and were not marked updated.",
    ];
    if (categories.prices.status === "SOURCE_FAILED") {
      notes.push("The price fetch failed. The previous stored bar is still the market date and was not presented as a new update.");
    } else if (!categories.prices.updatedThisRun) {
      notes.push(`The latest stored market date is still ${latestDate ?? "unavailable"}.`);
    }
    if (overall === "PARTIAL") {
      notes.push("One or more stages failed. Completed stages are listed individually.");
    }

    return finish({
      ticker: symbol,
      startedAt,
      completedAt: now().toISOString(),
      durable: true,
      persistence: "local-sqlite",
      overall,
      marketDate: latestDate,
      previousDate,
      priceUpdated: categories.prices.updatedThisRun,
      categories,
      research: scored.research,
      notes,
    });
  } finally {
    if (!args.joined) inFlight.delete(symbol);
  }
}

function runScores(
  runId: string,
  ticker: string,
  marketDate: string | null,
  now: () => Date,
  deps: RefreshAndResearchDeps,
): { category: RefreshCategoryReport; research: RefreshAndResearchReport["research"] } {
  const startedAt = now().toISOString();
  const score = deps.score ?? scoreTicker;
  try {
    const scored = score(ticker);
    const completedAt = now().toISOString();
    if (!scored) {
      const categoryReport = persistStage(runId, {
        dataset: "scores",
        source: "stored-snapshots",
        status: "SOURCE_FAILED",
        startedAt,
        completedAt,
        marketDate,
        attemptedCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 1,
        unavailableCount: 1,
        lastSuccessfulAt: null,
        errorSummary: "Research scoring found no stored instrument.",
        metadata: scopeMetadata(ticker, false),
      });
      return { category: categoryReport, research: emptyResearch() };
    }
    const close = scored.metrics.find((metric) => metric.id === "last_close");
    const trade = scored.metrics.find((metric) => metric.id === "last_trade_date");
    const scoreReady = typeof scored.result.researchScore === "number" && Number.isFinite(scored.result.researchScore);
    const categoryReport = persistStage(runId, {
      dataset: "scores",
      source: "stored-snapshots",
      status: scoreReady ? "SUCCESS" : "NO_DATA",
      startedAt,
      completedAt,
      marketDate: trade?.period ?? marketDate,
      attemptedCount: 1,
      updatedCount: scoreReady ? 1 : 0,
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: scoreReady ? 0 : 1,
      lastSuccessfulAt: null,
      errorSummary: scoreReady ? null : "Research score is unavailable from the stored inputs.",
      metadata: {
        ...scopeMetadata(ticker, scoreReady),
        researchRunAt: scored.result.asOf,
        priceUsed: close?.value ?? null,
        priceDateUsed: trade?.period ?? null,
      },
    });
    return {
      category: categoryReport,
      research: {
        ranAt: scored.result.asOf,
        priceUsed: close?.value ?? null,
        priceDateUsed: trade?.period ?? null,
        researchScore: scored.result.researchScore,
      },
    };
  } catch (error) {
    const completedAt = now().toISOString();
    const categoryReport = persistStage(runId, {
      dataset: "scores",
      source: "stored-snapshots",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 1,
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Research scoring failed",
      metadata: scopeMetadata(ticker, false),
    });
    return { category: categoryReport, research: emptyResearch() };
  }
}

function runFairValue(
  runId: string,
  ticker: string,
  asOf: string,
  marketDate: string | null,
  now: () => Date,
  deps: RefreshAndResearchDeps,
  inputsReady: boolean,
): RefreshCategoryReport {
  const startedAt = now().toISOString();
  if (!inputsReady) {
    const completedAt = now().toISOString();
    return persistStage(runId, {
      dataset: "fair_value",
      source: "stored-snapshots",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 1,
      lastSuccessfulAt: null,
      errorSummary: "Fair Value was not calculated because research scoring failed.",
      metadata: scopeMetadata(ticker, false),
    });
  }
  const fairValue = deps.fairValue ?? ((input) => refreshFairValueUniverse(input));
  try {
    const report = fairValue({ asOf, onlyTicker: ticker });
    const completedAt = now().toISOString();
    const outcome = fairValueRefreshOutcome(report);
    const interpreted = interpretFairValueStatus(report.attempted, outcome);
    return persistStage(runId, {
      dataset: "fair_value",
      source: "stored-snapshots",
      status: interpreted.status,
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: report.attempted,
      updatedCount: interpreted.status === "SUCCESS" ? outcome.updatedCount : 0,
      unchangedCount: interpreted.status === "UNCHANGED" ? outcome.unchangedCount : 0,
      failedCount: outcome.failedCount,
      unavailableCount: interpreted.status === "NO_DATA" ? 1 : outcome.unavailableCount,
      lastSuccessfulAt: null,
      errorSummary: interpreted.detail,
      metadata: { ...scopeMetadata(ticker, interpreted.status === "SUCCESS"), ...outcome.metadata },
    });
  } catch (error) {
    const completedAt = now().toISOString();
    return persistStage(runId, {
      dataset: "fair_value",
      source: "stored-snapshots",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 1,
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Fair Value failed",
      metadata: scopeMetadata(ticker, false),
    });
  }
}

async function runPrices(
  runId: string,
  ticker: string,
  previousDate: string | null,
  readPriceDate: (ticker: string) => string | null,
  now: () => Date,
  deps: RefreshAndResearchDeps,
): Promise<{ category: RefreshCategoryReport; latestDate: string | null }> {
  const startedAt = now().toISOString();
  const importPrices = deps.importPrices ?? importYahooPrices;
  const failedStage = (errorSummary: string, completedAt: string) => ({
    latestDate: previousDate,
    category: persistStage(runId, {
      dataset: "prices",
      source: "yahoo",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate: previousDate,
      attemptedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 1,
      lastSuccessfulAt: null,
      errorSummary,
      metadata: scopeMetadata(ticker, false),
    }),
  });
  try {
    const report = await importPrices({
      onlyTicker: ticker,
      listedOnly: true,
      skipAlerts: true,
      range: "5d",
      rateLimitMs: 100,
      skipUniverseSeed: true,
    });
    const completedAt = now().toISOString();
    const failed = report.succeeded.length === 0;
    if (failed) {
      return failedStage(
        report.failed.map((row) => row.reason).join("; ") || "Yahoo price fetch failed. Existing bars were kept.",
        completedAt,
      );
    }
    const latestDate = safePriceDate(readPriceDate, ticker) ?? previousDate;
    const advanced = Boolean(latestDate && (!previousDate || latestDate > previousDate));
    const status: RefreshStatus = advanced ? "SUCCESS" : "UNCHANGED";
    return {
      latestDate,
      category: persistStage(runId, {
        dataset: "prices",
        source: "yahoo",
        status,
        startedAt,
        completedAt,
        marketDate: latestDate,
        attemptedCount: 1,
        updatedCount: advanced ? 1 : 0,
        unchangedCount: advanced ? 0 : 1,
        failedCount: 0,
        unavailableCount: 0,
        lastSuccessfulAt: null,
        errorSummary: null,
        metadata: scopeMetadata(ticker, advanced),
      }),
    };
  } catch (error) {
    return failedStage(
      error instanceof Error ? error.message : "Yahoo price fetch failed. Existing bars were kept.",
      now().toISOString(),
    );
  }
}

async function runFundamentals(
  runId: string,
  ticker: string,
  marketDate: string | null,
  now: () => Date,
  deps: RefreshAndResearchDeps,
): Promise<RefreshCategoryReport> {
  const startedAt = now().toISOString();
  const importFundamentals = deps.importFundamentals ?? importYahooFundamentals;
  try {
    const report = await importFundamentals({
      onlyTicker: ticker,
      rateLimitMs: 100,
      freshnessGate: { asOf: now(), recheckAfterDays: DAILY_FUNDAMENTALS_RECHECK_DAYS },
    });
    const completedAt = now().toISOString();
    const interpreted = interpretFundamentals(report);
    return persistStage(runId, {
      dataset: "fundamentals",
      source: "yahoo",
      status: interpreted.status,
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: report.attempted,
      updatedCount: report.instrumentsUpdated,
      unchangedCount: report.instrumentsUnchanged,
      failedCount: interpreted.status === "SOURCE_FAILED" || interpreted.status === "PARTIAL" ? report.failed.length : 0,
      unavailableCount: interpreted.status === "NO_DATA" ? report.attempted : report.failed.length,
      lastSuccessfulAt: null,
      errorSummary: interpreted.detail,
      metadata: {
        ...scopeMetadata(ticker, interpreted.status === "SUCCESS"),
        instrumentsSkippedFresh: report.instrumentsSkippedFresh,
        instrumentsFetched: report.instrumentsFetched,
      },
    });
  } catch (error) {
    const completedAt = now().toISOString();
    return persistStage(runId, {
      dataset: "fundamentals",
      source: "yahoo",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 1,
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Yahoo fundamentals failed. Prior periods were kept.",
      metadata: scopeMetadata(ticker, false),
    });
  }
}

function persistQuiet(
  runId: string,
  ticker: string,
  dataset: "events" | "news",
  source: string,
  stamp: string,
  marketDate: string | null,
  detail: string,
): RefreshCategoryReport {
  return persistStage(runId, {
    dataset,
    source,
    status: "NO_SOURCE",
    startedAt: stamp,
    completedAt: stamp,
    marketDate,
    attemptedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    unavailableCount: 1,
    lastSuccessfulAt: null,
    errorSummary: detail,
    metadata: scopeMetadata(ticker, false),
  });
}

function persistStage(runId: string, result: DatasetRefreshResult): RefreshCategoryReport {
  const stored = persistDatasetRefresh(runId, result);
  const metadata = result.metadata ?? {};
  const id = categoryIdFromDataset(stored.dataset) ?? "prices";
  return {
    id,
    status: stored.status,
    source: stored.source,
    attempted: stored.attemptedCount,
    succeeded: stored.updatedCount + stored.unchangedCount,
    failed: stored.failedCount,
    updatedThisRun: metadata.updatedThisRun === true,
    lastSuccessfulAt: stored.lastSuccessfulAt,
    detail: stored.errorSummary,
  };
}

function interpretFundamentals(report: YahooFundamentalsReport): { status: RefreshStatus; detail: string | null } {
  if (report.attempted === 0) {
    return { status: "SOURCE_FAILED", detail: "Yahoo fundamentals did not attempt this instrument." };
  }
  if (report.failed.length === report.attempted) {
    const detail = report.failed.map((row) => row.reason).join("; ") || "Yahoo fundamentals were not updated.";
    const missing = report.failed.every((row) => row.code === "NO_DATA" || row.code === "UNSUPPORTED");
    return { status: missing ? "NO_DATA" : "SOURCE_FAILED", detail };
  }
  if (report.failed.length > 0) {
    return {
      status: "PARTIAL",
      detail: report.failed.map((row) => row.reason).join("; "),
    };
  }
  if (report.instrumentsUpdated > 0 || report.upserted > 0) return { status: "SUCCESS", detail: null };
  if (report.instrumentsSkippedFresh > 0) {
    return {
      status: "UNCHANGED",
      detail: "Stored Yahoo fundamentals are still inside the recheck window and were kept.",
    };
  }
  return { status: "UNCHANGED", detail: null };
}

function interpretFairValueStatus(
  attempted: number,
  outcome: ReturnType<typeof fairValueRefreshOutcome>,
): { status: RefreshStatus; detail: string | null } {
  if (attempted === 0) {
    return { status: "SOURCE_FAILED", detail: "Fair Value did not calculate this instrument." };
  }
  if (outcome.status === "SOURCE_FAILED" || outcome.status === "PARTIAL") {
    return { status: outcome.status, detail: outcome.errorSummary };
  }
  const unsupported = Number(outcome.metadata.unsupported ?? 0);
  const noValue = Number(outcome.metadata.noValue ?? 0);
  if (unsupported > 0) {
    return { status: "NO_DATA", detail: "No Fair Value model applies to this research profile. Nothing was invented." };
  }
  if (noValue > 0) {
    return { status: "NO_DATA", detail: "Fair Value did not produce a value from the stored inputs." };
  }
  return { status: outcome.status, detail: outcome.errorSummary };
}

function overallStatus(categories: Record<RefreshCategoryId, RefreshCategoryReport>): OnDemandOverall {
  const active = [categories.prices, categories.fundamentals, categories.scores, categories.fairValue];
  const failed = active.filter((row) => row.status === "SOURCE_FAILED" || row.status === "PARTIAL" || row.status === "NOT_RUN");
  if (failed.length === 0 && active.every((row) => row.status === "UNCHANGED" || row.status === "NO_DATA")) {
    return "UNCHANGED";
  }
  if (failed.length === 0) return "SUCCESS";
  const completed = active.some(
    (row) => row.status === "SUCCESS" || row.status === "UNCHANGED" || row.status === "PARTIAL" || row.status === "NO_DATA",
  );
  return completed ? "PARTIAL" : "SOURCE_FAILED";
}

function latestStoredPriceDate(ticker: string): string | null {
  const db = getDb();
  const instrument = db.select().from(instruments).where(eq(instruments.ticker, ticker)).get();
  if (!instrument) return null;
  const row = db
    .select({ barDate: priceBars.barDate })
    .from(priceBars)
    .where(and(eq(priceBars.instrumentId, instrument.id), isNotNull(priceBars.close)))
    .orderBy(desc(priceBars.barDate))
    .get();
  return row?.barDate ?? null;
}

function safePriceDate(read: (ticker: string) => string | null, ticker: string): string | null {
  try {
    return read(ticker);
  } catch {
    return null;
  }
}

function scopeMetadata(ticker: string, updatedThisRun: boolean) {
  return { kind: "refresh-and-research", ticker, updatedThisRun };
}

function category(row: RefreshCategoryReport): RefreshCategoryReport {
  return row;
}

function notRunCategories(marketDate: string | null): Record<RefreshCategoryId, RefreshCategoryReport> {
  const blank = (id: RefreshCategoryId, source: string): RefreshCategoryReport => ({
    id,
    status: "NOT_RUN",
    source,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    updatedThisRun: false,
    lastSuccessfulAt: null,
    detail: marketDate ? `Not run. Stored market date remains ${marketDate}.` : "Not run.",
  });
  return {
    prices: blank("prices", "yahoo"),
    fundamentals: blank("fundamentals", "yahoo"),
    announcements: blank("announcements", "csv"),
    events: blank("events", "bursa-live-unavailable"),
    news: blank("news", "none"),
    scores: blank("scores", "stored-snapshots"),
    fairValue: blank("fairValue", "stored-snapshots"),
  };
}

function emptyResearch(): RefreshAndResearchReport["research"] {
  return { ranAt: null, priceUsed: null, priceDateUsed: null, researchScore: null };
}

function categoryIdFromDataset(dataset: string): RefreshCategoryId | null {
  if (dataset === "fair_value") return "fairValue";
  if (dataset === "prices" || dataset === "fundamentals" || dataset === "events" || dataset === "news" || dataset === "scores") {
    return dataset;
  }
  return null;
}

function parseMetadata(raw: string | null): { ticker?: string; kind?: string; updatedThisRun?: boolean } {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as { ticker?: string; kind?: string; updatedThisRun?: boolean };
  } catch {
    return {};
  }
}

function finish(args: {
  ticker: string;
  startedAt: string;
  completedAt: string;
  durable: boolean;
  persistence: RefreshAndResearchReport["persistence"];
  overall: OnDemandOverall;
  marketDate: string | null;
  previousDate: string | null;
  priceUpdated: boolean;
  categories: Record<RefreshCategoryId, RefreshCategoryReport>;
  research: RefreshAndResearchReport["research"];
  notes: string[];
}): RefreshAndResearchReport {
  const prices = args.categories.prices;
  const fundamentals = args.categories.fundamentals;
  return {
    kind: "refresh-and-research",
    scope: "instrument",
    ticker: args.ticker,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durable: args.durable,
    persistence: args.persistence,
    overall: args.overall,
    market: {
      source: "yahoo",
      cadence: PRICE_CADENCE,
      realtime: false,
      previousDate: args.previousDate,
      latestDate: args.marketDate,
      updatedThisRun: args.priceUpdated,
    },
    instruments: {
      attempted: args.overall === "REFUSED" || args.overall === "ALREADY_RUNNING" ? 0 : 1,
      priceSucceeded: prices.status === "SUCCESS" || prices.status === "UNCHANGED" ? 1 : 0,
      priceFailed: prices.status === "SOURCE_FAILED" ? 1 : 0,
      fundamentalsSucceeded: fundamentals.status === "SUCCESS" || fundamentals.status === "UNCHANGED" ? 1 : 0,
      fundamentalsFailed: fundamentals.status === "SOURCE_FAILED" ? 1 : 0,
    },
    categories: args.categories,
    calculations: {
      scores: args.categories.scores.status === "SUCCESS" || args.categories.scores.status === "UNCHANGED",
      fairValue: args.categories.fairValue.status === "SUCCESS" || args.categories.fairValue.status === "UNCHANGED",
    },
    research: args.research,
    notes: args.notes,
  };
}
