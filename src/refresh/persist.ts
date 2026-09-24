import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { refreshRuns, type RefreshDataset } from "@/db/schema";
import {
  advancesLastSuccessful,
  type DatasetRefreshResult,
} from "@/refresh/types";

export function loadLastSuccessfulAt(dataset: RefreshDataset, source: string): string | null {
  const db = getDb();
  const rows = db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.dataset, dataset), eq(refreshRuns.source, source)))
    .orderBy(desc(refreshRuns.id))
    .all();
  for (const row of rows) {
    if (row.lastSuccessfulAt) return row.lastSuccessfulAt;
  }
  return null;
}

export function persistDatasetRefresh(
  runId: string,
  result: DatasetRefreshResult,
): DatasetRefreshResult {
  const prior = loadLastSuccessfulAt(result.dataset, result.source);
  const lastSuccessfulAt = advancesLastSuccessful(result.status)
    ? result.completedAt
    : prior;
  const stored: DatasetRefreshResult = { ...result, lastSuccessfulAt };
  getDb()
    .insert(refreshRuns)
    .values({
      runId,
      dataset: stored.dataset,
      source: stored.source,
      status: stored.status,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      marketDate: stored.marketDate,
      attemptedCount: stored.attemptedCount,
      updatedCount: stored.updatedCount,
      unchangedCount: stored.unchangedCount,
      failedCount: stored.failedCount,
      unavailableCount: stored.unavailableCount,
      lastSuccessfulAt: stored.lastSuccessfulAt,
      errorSummary: stored.errorSummary,
      metadataJson: stored.metadata ? JSON.stringify(stored.metadata) : null,
    })
    .run();
  return stored;
}

export function loadLatestDatasetRefresh(dataset: RefreshDataset): DatasetRefreshResult | null {
  const row = getDb()
    .select()
    .from(refreshRuns)
    .where(eq(refreshRuns.dataset, dataset))
    .orderBy(desc(refreshRuns.id))
    .get();
  if (!row) return null;
  return {
    dataset: row.dataset as DatasetRefreshResult["dataset"],
    source: row.source,
    status: row.status as DatasetRefreshResult["status"],
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    marketDate: row.marketDate,
    attemptedCount: row.attemptedCount,
    updatedCount: row.updatedCount,
    unchangedCount: row.unchangedCount,
    failedCount: row.failedCount,
    unavailableCount: row.unavailableCount,
    lastSuccessfulAt: row.lastSuccessfulAt,
    errorSummary: row.errorSummary,
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : undefined,
  };
}
