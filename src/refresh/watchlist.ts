import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { clearOpportunityScanCache } from "@/opportunities/scan";
import {
  claimRefreshTickers,
  markWatchlistRefreshActive,
  PRICE_CADENCE,
  refreshInFlightCount,
  releaseRefreshTickers,
  resetRefreshAndResearchLockForTests,
  runRefreshAndResearch,
  type OnDemandOverall,
  type RefreshAndResearchDeps,
  type RefreshAndResearchReport,
} from "@/refresh/on-demand";

export const WATCHLIST_PACE_MS = 400;

let cancelRequested = false;

export type WatchlistProgress = {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  cancelled: boolean;
};

export type WatchlistOverall = OnDemandOverall | "CANCELLED";

export type WatchlistRefreshReport = {
  kind: "watchlist-refresh-and-research";
  startedAt: string;
  completedAt: string;
  durable: boolean;
  persistence: RefreshAndResearchReport["persistence"];
  overall: WatchlistOverall;
  cancelled: boolean;
  paceMs: number;
  watchlistSize: number;
  attempted: number;
  completed: number;
  failed: number;
  skipped: string[];
  failedTickers: string[];
  market: {
    source: "yahoo";
    cadence: typeof PRICE_CADENCE;
    realtime: false;
    oldestPreviousDate: string | null;
    latestMarketDate: string | null;
    updatedCount: number;
  };
  calculations: {
    scores: number;
    fairValue: number;
  };
  sourcesNotUpdated: ["announcements", "events", "news"];
  results: RefreshAndResearchReport[];
  notes: string[];
};

export type WatchlistRefreshDeps = RefreshAndResearchDeps & {
  listTickers?: () => string[];
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: WatchlistProgress) => void;
};

export function resetWatchlistRefreshForTests() {
  cancelRequested = false;
  resetRefreshAndResearchLockForTests();
}

export function cancelWatchlistRefresh() {
  const running = refreshInFlightCount() > 0;
  cancelRequested = true;
  return running;
}

export function listWatchlistTickers(): string[] {
  return getDb()
    .select({ ticker: instruments.ticker })
    .from(instruments)
    .where(and(eq(instruments.watchlist, true), ne(instruments.listingStatus, "inactive")))
    .orderBy(asc(instruments.ticker))
    .all()
    .map((row) => row.ticker);
}

export async function runWatchlistRefreshAndResearch(
  args: { onlyTickers?: string[]; paceMs?: number; signal?: AbortSignal } = {},
  deps: WatchlistRefreshDeps = {},
): Promise<WatchlistRefreshReport> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const paceMs = args.paceMs ?? WATCHLIST_PACE_MS;
  const listTickers = deps.listTickers ?? listWatchlistTickers;

  if (refuseSnapshotWrites("watchlist-refresh-and-research")) {
    return summarize({
      startedAt,
      completedAt: now().toISOString(),
      paceMs,
      watchlistSize: safeList(listTickers).length,
      results: [],
      skipped: [],
      cancelled: false,
      ignored: [],
      persistence: "refused-read-only-snapshot",
      overall: "REFUSED",
      notes: [
        "This process uses a read-only SQLite snapshot. The watchlist was not fetched and nothing was saved.",
        "Local SQLite can store a watchlist refresh. The deployed website keeps the frozen snapshot until a new one is packed and deployed.",
        "Yahoo prices are end-of-day daily bars, not a live quote.",
      ],
    });
  }

  if (refreshInFlightCount() > 0) {
    return blocked(startedAt, now().toISOString(), paceMs, "A Refresh & Research run is already in progress. This watchlist request did not start another one.");
  }

  cancelRequested = false;
  markWatchlistRefreshActive(true);
  const held: string[] = [];
  try {
    const watchlist = safeList(listTickers);
    const requested = args.onlyTickers?.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
    const tickers = requested ? watchlist.filter((ticker) => requested.includes(ticker)) : watchlist;
    const ignored = requested ? requested.filter((ticker) => !watchlist.includes(ticker)) : [];
    claimRefreshTickers(tickers);
    held.push(...tickers);

    const results: RefreshAndResearchReport[] = [];
    const skipped: string[] = [];
    let cancelled = false;
    const sleep = deps.sleep ?? defaultSleep;

    for (let index = 0; index < tickers.length; index += 1) {
      if (args.signal?.aborted || cancelRequested) {
        cancelled = true;
        skipped.push(...tickers.slice(index));
        break;
      }
      const ticker = tickers[index]!;
      emit(deps, {
        total: tickers.length,
        completed: results.length,
        failed: failureCount(results),
        current: ticker,
        cancelled: false,
      });
      try {
        results.push(await runRefreshAndResearch({ ticker, joined: true }, deps));
      } catch (error) {
        results.push(failedTickerReport(ticker, error, now));
      }
      emit(deps, {
        total: tickers.length,
        completed: results.length,
        failed: failureCount(results),
        current: null,
        cancelled: false,
      });
      const more = index < tickers.length - 1;
      if (more && paceMs > 0 && !args.signal?.aborted && !cancelRequested) {
        await sleep(paceMs);
      }
    }

    if (tickers.length > 0 && results.some((row) => row.durable)) clearOpportunityScanCache();

    const notes = [
      "Yahoo prices are end-of-day daily bars, not a live quote. Requests run one watchlist name at a time.",
      "Events, news, and announcements have no production feed on this action and were not marked updated.",
      "Results are stored in the local research database. The deployed website is unchanged until a new snapshot is packed and deployed.",
    ];
    if (ignored.length) notes.push(`Ignored names that are not on the watchlist: ${ignored.join(", ")}.`);
    if (cancelled) notes.push("The run stopped before the remaining watchlist names. Those names were not fetched.");
    if (failureCount(results) > 0) notes.push("Failed names stayed failed. The other names still ran.");

    const wrote = results.some((row) => row.durable);
    return summarize({
      startedAt,
      completedAt: now().toISOString(),
      paceMs,
      watchlistSize: watchlist.length,
      results,
      skipped,
      cancelled,
      ignored,
      persistence: wrote ? "local-sqlite" : "not-written",
      overall: cancelled ? "CANCELLED" : overallFrom(results),
      notes,
    });
  } finally {
    releaseRefreshTickers(held);
    markWatchlistRefreshActive(false);
    cancelRequested = false;
  }
}

function blocked(startedAt: string, completedAt: string, paceMs: number, note: string): WatchlistRefreshReport {
  return summarize({
    startedAt,
    completedAt,
    paceMs,
    watchlistSize: 0,
    results: [],
    skipped: [],
    cancelled: false,
    ignored: [],
    persistence: "not-written",
    overall: "ALREADY_RUNNING",
    notes: [note],
  });
}

function summarize(args: {
  startedAt: string;
  completedAt: string;
  paceMs: number;
  watchlistSize: number;
  results: RefreshAndResearchReport[];
  skipped: string[];
  cancelled: boolean;
  ignored: string[];
  persistence: WatchlistRefreshReport["persistence"];
  overall: WatchlistOverall;
  notes: string[];
}): WatchlistRefreshReport {
  const dates = args.results.map((row) => row.market.latestDate).filter((value): value is string => Boolean(value)).sort();
  const previous = args.results.map((row) => row.market.previousDate).filter((value): value is string => Boolean(value)).sort();
  const failedTickers = args.results.filter(isTickerFailure).map((row) => row.ticker);
  return {
    kind: "watchlist-refresh-and-research",
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durable: args.persistence === "local-sqlite" && args.results.some((row) => row.durable),
    persistence: args.persistence,
    overall: args.overall,
    cancelled: args.cancelled,
    paceMs: args.paceMs,
    watchlistSize: args.watchlistSize,
    attempted: args.results.length,
    completed: args.results.length,
    failed: failedTickers.length,
    skipped: args.skipped,
    failedTickers,
    market: {
      source: "yahoo",
      cadence: PRICE_CADENCE,
      realtime: false,
      oldestPreviousDate: previous[0] ?? null,
      latestMarketDate: dates.at(-1) ?? null,
      updatedCount: args.results.filter((row) => row.market.updatedThisRun).length,
    },
    calculations: {
      scores: args.results.filter((row) => row.calculations.scores).length,
      fairValue: args.results.filter((row) => row.calculations.fairValue).length,
    },
    sourcesNotUpdated: ["announcements", "events", "news"],
    results: args.results,
    notes: args.notes,
  };
}

function overallFrom(results: RefreshAndResearchReport[]): WatchlistOverall {
  if (results.length === 0) return "UNCHANGED";
  const failed = results.filter(isTickerFailure);
  if (failed.length === results.length) return "SOURCE_FAILED";
  if (failed.length > 0) return "PARTIAL";
  return "SUCCESS";
}

function isTickerFailure(row: RefreshAndResearchReport) {
  return row.overall === "SOURCE_FAILED" || row.overall === "PARTIAL" || row.overall === "REFUSED" || row.overall === "ALREADY_RUNNING";
}

function failureCount(results: RefreshAndResearchReport[]) {
  return results.filter(isTickerFailure).length;
}

function emit(deps: WatchlistRefreshDeps, progress: WatchlistProgress) {
  deps.onProgress?.(progress);
}

function safeList(list: () => string[]) {
  try {
    return list().map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function failedTickerReport(ticker: string, error: unknown, now: () => Date): RefreshAndResearchReport {
  const stamp = now().toISOString();
  const detail = error instanceof Error ? error.message : "Refresh failed";
  return {
    kind: "refresh-and-research",
    scope: "instrument",
    ticker,
    startedAt: stamp,
    completedAt: stamp,
    durable: false,
    persistence: "not-written",
    overall: "SOURCE_FAILED",
    market: {
      source: "yahoo",
      cadence: PRICE_CADENCE,
      realtime: false,
      previousDate: null,
      latestDate: null,
      updatedThisRun: false,
    },
    instruments: { attempted: 1, priceSucceeded: 0, priceFailed: 1, fundamentalsSucceeded: 0, fundamentalsFailed: 0 },
    categories: {
      prices: blank("prices", detail),
      fundamentals: blank("fundamentals", detail),
      announcements: blank("announcements", detail),
      events: blank("events", detail),
      news: blank("news", detail),
      scores: blank("scores", detail),
      fairValue: blank("fairValue", detail),
    },
    calculations: { scores: false, fairValue: false },
    research: { ranAt: null, priceUsed: null, priceDateUsed: null, researchScore: null },
    notes: [detail],
  };
}

function blank(id: RefreshAndResearchReport["categories"]["prices"]["id"], detail: string): RefreshAndResearchReport["categories"]["prices"] {
  return {
    id,
    status: "SOURCE_FAILED",
    source: "yahoo",
    attempted: 1,
    succeeded: 0,
    failed: 1,
    updatedThisRun: false,
    lastSuccessfulAt: null,
    detail,
  };
}
