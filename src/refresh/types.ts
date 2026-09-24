import type { RefreshDataset, RefreshStatus } from "@/db/schema";

export type { RefreshDataset, RefreshStatus };

export type DatasetRefreshResult = {
  dataset: RefreshDataset;
  source: string;
  status: RefreshStatus;
  startedAt: string;
  completedAt: string;
  marketDate: string | null;
  attemptedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  unavailableCount: number;
  lastSuccessfulAt: string | null;
  errorSummary: string | null;
  metadata?: Record<string, unknown>;
};

export type DailyRefreshSummary = {
  kind: "daily-refresh";
  runId: string;
  startedAt: string;
  completedAt: string;
  marketDate: string;
  timezone: "Asia/Kuala_Lumpur";
  universeCount: number;
  overallStatus: RefreshStatus;
  datasets: DatasetRefreshResult[];
  notes: string[];
};

export function isSuccessfulRefreshStatus(status: RefreshStatus): boolean {
  return (
    status === "SUCCESS" ||
    status === "PARTIAL" ||
    status === "UNCHANGED" ||
    status === "NO_DATA"
  );
}

/** Advance last_successful_at only when usable data contact succeeded (including unchanged / empty-but-ok). */
export function advancesLastSuccessful(status: RefreshStatus): boolean {
  return isSuccessfulRefreshStatus(status);
}

export function combineOverallStatus(results: DatasetRefreshResult[]): RefreshStatus {
  const critical = results.filter((r) => r.dataset === "prices" || r.dataset === "fundamentals");
  const pool = critical.length ? critical : results;
  const statuses = pool.map((r) => r.status);
  if (statuses.every((s) => s === "SUCCESS" || s === "UNCHANGED" || s === "NO_DATA")) {
    return statuses.some((s) => s === "SUCCESS") ? "SUCCESS" : "UNCHANGED";
  }
  if (statuses.every((s) => s === "SOURCE_FAILED" || s === "NO_SOURCE")) {
    return statuses.includes("SOURCE_FAILED") ? "SOURCE_FAILED" : "NO_SOURCE";
  }
  return "PARTIAL";
}

export function malaysiaMarketDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function newRefreshRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `refresh-${stamp}`;
}
