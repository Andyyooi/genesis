import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { UnavailableLiveBursaEventProvider } from "@/events/fixture-provider";
import type { EventSourceProvider } from "@/events/types";
import { importYahooPrices, type PriceIngestOptions } from "@/ingest/import-prices";
import type { PricesImportReport } from "@/ingest/types";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import {
  importYahooFundamentals,
  type YahooFundamentalsReport,
} from "@/market/ingest-fundamentals-yahoo";
import { rescoreListedMarket } from "@/market/scan";
import { persistDatasetRefresh } from "@/refresh/persist";
import {
  combineOverallStatus,
  malaysiaMarketDate,
  newRefreshRunId,
  type DailyRefreshSummary,
  type DatasetRefreshResult,
  type RefreshStatus,
} from "@/refresh/types";

export type DailyRefreshDeps = {
  importPrices?: (opts?: PriceIngestOptions) => Promise<PricesImportReport>;
  importFundamentals?: () => Promise<YahooFundamentalsReport>;
  eventsProvider?: EventSourceProvider | null;
  /** null / undefined → NO_SOURCE for news (no production news table yet). */
  newsAvailable?: boolean;
  rescore?: () => unknown;
  now?: () => Date;
};

function countListed(): number {
  return getDb()
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive").length;
}

function pricesStatus(report: PricesImportReport): RefreshStatus {
  const attempted = report.succeeded.length + report.failed.length;
  if (attempted === 0) return "NO_DATA";
  if (report.failed.length === 0) {
    return report.barsUpserted > 0 ? "SUCCESS" : "UNCHANGED";
  }
  if (report.succeeded.length === 0) return "SOURCE_FAILED";
  return "PARTIAL";
}

function fundamentalsStatus(report: YahooFundamentalsReport): RefreshStatus {
  if (report.attempted === 0) return "NO_DATA";
  if (report.failed.length === report.attempted) return "SOURCE_FAILED";
  if (report.failed.length > 0) return "PARTIAL";
  if (report.instrumentsUpdated > 0 || report.upserted > 0) return "SUCCESS";
  return "UNCHANGED";
}

async function refreshPrices(
  runId: string,
  marketDate: string,
  deps: DailyRefreshDeps,
): Promise<DatasetRefreshResult> {
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const importPrices = deps.importPrices ?? importYahooPrices;
  try {
    const report = await importPrices({
      listedOnly: true,
      skipAlerts: true,
      range: "1mo",
      rateLimitMs: 200,
    });
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    const status = pricesStatus(report);
    return persistDatasetRefresh(runId, {
      dataset: "prices",
      source: "yahoo",
      status,
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: report.succeeded.length + report.failed.length,
      updatedCount: report.succeeded.length,
      unchangedCount: 0,
      failedCount: report.failed.length,
      unavailableCount: report.failed.length,
      lastSuccessfulAt: null,
      errorSummary:
        report.failed.length > 0
          ? `Yahoo price miss for ${report.failed.length} instruments (existing bars preserved).`
          : null,
      metadata: {
        barsUpserted: report.barsUpserted,
        failedSample: report.failed.slice(0, 10),
      },
    });
  } catch (error) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "prices",
      source: "yahoo",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: countListed(),
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: countListed(),
      unavailableCount: countListed(),
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Yahoo prices failed",
    });
  }
}

async function refreshFundamentals(
  runId: string,
  marketDate: string,
  deps: DailyRefreshDeps,
): Promise<DatasetRefreshResult> {
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const importFundamentals = deps.importFundamentals ?? importYahooFundamentals;
  try {
    const report = await importFundamentals();
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "fundamentals",
      source: "yahoo",
      status: fundamentalsStatus(report),
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: report.attempted,
      updatedCount: report.instrumentsUpdated,
      unchangedCount: report.instrumentsUnchanged,
      failedCount: report.failed.length,
      unavailableCount: report.failed.length,
      lastSuccessfulAt: null,
      errorSummary:
        report.failed.length > 0
          ? `Yahoo fundamentals issues for ${report.failed.length} instruments (prior periods preserved).`
          : null,
      metadata: {
        inserted: report.inserted,
        filled: report.filled,
        unchangedPeriods: report.unchanged,
        skippedOtherSource: report.skippedOtherSource,
      },
    });
  } catch (error) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "fundamentals",
      source: "yahoo",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: countListed(),
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: countListed(),
      unavailableCount: countListed(),
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Yahoo fundamentals failed",
    });
  }
}

async function refreshEvents(
  runId: string,
  marketDate: string,
  deps: DailyRefreshDeps,
): Promise<DatasetRefreshResult> {
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const provider = deps.eventsProvider ?? new UnavailableLiveBursaEventProvider();
  const universe = countListed();

  // Production daily path: live announcements unresolved (Phase 18). Do not wipe fixtures.
  if (provider.id === "bursa-live-unavailable" || deps.eventsProvider === null) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "events",
      source: provider.id,
      status: "NO_SOURCE",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: universe,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: universe,
      lastSuccessfulAt: null,
      errorSummary:
        "No production structured-events provider enabled. Existing events preserved. See docs/phase18-source-strategy.md.",
    });
  }

  try {
    const drafts = await provider.list([]);
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    if (drafts.length === 0) {
      return persistDatasetRefresh(runId, {
        dataset: "events",
        source: provider.id,
        status: "NO_DATA",
        startedAt,
        completedAt,
        marketDate,
        attemptedCount: universe,
        updatedCount: 0,
        unchangedCount: 0,
        failedCount: 0,
        unavailableCount: universe,
        lastSuccessfulAt: null,
        errorSummary: "Events provider returned no rows (existing events preserved).",
      });
    }
    // Provider returned drafts — daily refresh still does not auto-upsert into production
    // until ToS/QA gate passes. Record as NO_SOURCE to avoid silent writes.
    return persistDatasetRefresh(runId, {
      dataset: "events",
      source: provider.id,
      status: "NO_SOURCE",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: drafts.length,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: drafts.length,
      lastSuccessfulAt: null,
      errorSummary:
        "Events provider is evaluation-only in Phase 18B; rows not written. Existing events preserved.",
      metadata: { draftCount: drafts.length },
    });
  } catch (error) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "events",
      source: provider.id,
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: universe,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: universe,
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Events provider failed",
    });
  }
}

function refreshNews(
  runId: string,
  marketDate: string,
  deps: DailyRefreshDeps,
): DatasetRefreshResult {
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const completedAt = startedAt;
  const universe = countListed();
  if (deps.newsAvailable) {
    return persistDatasetRefresh(runId, {
      dataset: "news",
      source: "unconfigured",
      status: "NO_SOURCE",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: universe,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: universe,
      lastSuccessfulAt: null,
      errorSummary: "News flag set but no production news store/provider is implemented yet.",
    });
  }
  return persistDatasetRefresh(runId, {
    dataset: "news",
    source: "none",
    status: "NO_SOURCE",
    startedAt,
    completedAt,
    marketDate,
    attemptedCount: universe,
    updatedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    unavailableCount: universe,
    lastSuccessfulAt: null,
    errorSummary:
      "No general-news provider configured. Absence of news is not neutral tone. Existing rows preserved.",
  });
}

function refreshScores(
  runId: string,
  marketDate: string,
  deps: DailyRefreshDeps,
  prior: DatasetRefreshResult[],
): DatasetRefreshResult {
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  const shouldRescore = prior.some(
    (r) =>
      (r.dataset === "prices" || r.dataset === "fundamentals") &&
      (r.status === "SUCCESS" || r.status === "PARTIAL" || r.status === "UNCHANGED"),
  );
  if (!shouldRescore) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "scores",
      source: "rescore-skipped",
      status: "UNCHANGED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: 0,
      lastSuccessfulAt: null,
      errorSummary: "Skipped rescore because prices/fundamentals did not complete usefully.",
    });
  }
  try {
    const rescore = deps.rescore ?? rescoreListedMarket;
    const summary = rescore();
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "scores",
      source: "scoreTicker",
      status: "SUCCESS",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: countListed(),
      updatedCount: countListed(),
      unchangedCount: 0,
      failedCount: 0,
      unavailableCount: 0,
      lastSuccessfulAt: null,
      errorSummary: null,
      metadata: {
        note: "Methodology unchanged; news/events still excluded from Research Score.",
        summaryKind: typeof summary === "object" && summary && "kind" in summary ? summary.kind : null,
      },
    });
  } catch (error) {
    const completedAt = (deps.now?.() ?? new Date()).toISOString();
    return persistDatasetRefresh(runId, {
      dataset: "scores",
      source: "scoreTicker",
      status: "SOURCE_FAILED",
      startedAt,
      completedAt,
      marketDate,
      attemptedCount: countListed(),
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 1,
      unavailableCount: 0,
      lastSuccessfulAt: null,
      errorSummary: error instanceof Error ? error.message : "Rescore failed",
    });
  }
}

/**
 * Manual daily batch refresh. Datasets are independent: events/news NO_SOURCE
 * must not block prices/fundamentals. Never overwrites valid rows with null on failure.
 */
export async function runDailyRefresh(
  deps: DailyRefreshDeps = {},
): Promise<DailyRefreshSummary> {
  if (refuseSnapshotWrites("daily refresh")) {
    throw new Error("Daily refresh refused: read-only snapshot mode");
  }
  const nowFn = deps.now ?? (() => new Date());
  const startedAt = nowFn().toISOString();
  const runId = newRefreshRunId(nowFn());
  const marketDate = malaysiaMarketDate(nowFn());
  const universeCount = countListed();
  const notes: string[] = [
    "News/events remain display-only and do not change Research Score.",
    "Failed retrievals preserve prior valid prices/fundamentals/events.",
    "Missing data is never stored as zero.",
  ];

  const prices = await refreshPrices(runId, marketDate, deps);
  const fundamentals = await refreshFundamentals(runId, marketDate, deps);
  const events = await refreshEvents(runId, marketDate, deps);
  const news = refreshNews(runId, marketDate, deps);
  const scores = refreshScores(runId, marketDate, deps, [prices, fundamentals]);

  const datasets = [prices, fundamentals, events, news, scores];
  const completedAt = nowFn().toISOString();
  return {
    kind: "daily-refresh",
    runId,
    startedAt,
    completedAt,
    marketDate,
    timezone: "Asia/Kuala_Lumpur",
    universeCount,
    overallStatus: combineOverallStatus(datasets),
    datasets,
    notes,
  };
}

export function formatDailyRefreshSummary(summary: DailyRefreshSummary): string {
  const lines = [
    "Genesis Daily Refresh",
    "",
    `Run: ${summary.runId}`,
    `Market date (${summary.timezone}): ${summary.marketDate}`,
    `Universe: ${summary.universeCount} instruments`,
    `Overall: ${summary.overallStatus}`,
    "",
  ];
  for (const d of summary.datasets) {
    lines.push(d.dataset.toUpperCase());
    lines.push(`  source: ${d.source}`);
    lines.push(`  status: ${d.status}`);
    lines.push(
      `  attempted=${d.attemptedCount} updated=${d.updatedCount} unchanged=${d.unchangedCount} failed=${d.failedCount} unavailable=${d.unavailableCount}`,
    );
    lines.push(`  last_successful_at: ${d.lastSuccessfulAt ?? "never"}`);
    if (d.errorSummary) lines.push(`  note: ${d.errorSummary}`);
    lines.push("");
  }
  for (const note of summary.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}
