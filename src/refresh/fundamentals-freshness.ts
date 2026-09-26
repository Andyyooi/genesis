import { latestAnnualIsFull, parseLineItemsJson } from "@/ingest/merge-line-items";

/**
 * Daily refresh only: minimum days between Yahoo fundamentals HTTP checks for an
 * instrument that already has a complete latest Yahoo annual.
 *
 * Annual filings appear infrequently. Fourteen days is a conservative discovery
 * window for a newer fiscal year on Yahoo without re-pulling full history every
 * post-market run. Manual `importYahooFundamentals()` (no gate) still does a
 * full backfill.
 *
 * Uses existing `financial_periods.retrieved_at` (ingest provenance), not a
 * parallel refresh-state store. Scoring freshness bands (FRESH/AGING/…) are
 * unchanged and still keyed off period_end / available_at.
 */
export const DAILY_FUNDAMENTALS_RECHECK_DAYS = 14;

export type YahooAnnualSnapshot = {
  periodEnd: string;
  retrievedAt: string;
  lineItemsJson: string | null;
};

export type FundamentalsFreshnessReason =
  | "no_yahoo_annuals"
  | "incomplete_latest"
  | "recheck_due"
  | "fresh_complete";

export type FundamentalsFreshnessDecision = {
  needsRefresh: boolean;
  reason: FundamentalsFreshnessReason;
  latestPeriodEnd: string | null;
  latestRetrievedAt: string | null;
  recheckAfterDays: number;
  daysSinceRetrieved: number | null;
};

function utcDayMs(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole UTC calendar days from `fromIso` to `asOf` (non-negative when asOf ≥ from). */
export function utcCalendarDaysBetween(fromIso: string, asOf: Date): number | null {
  const from = utcDayMs(fromIso);
  if (from === null) return null;
  const to = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  return Math.floor((to - from) / 86_400_000);
}

/**
 * Deterministic gate: call Yahoo only when annuals are missing, the latest Yahoo
 * annual is incomplete (not full core trio), or the last successful ingest of
 * those annuals is at least `recheckAfterDays` old.
 */
export function evaluateFundamentalsFreshness(args: {
  yahooAnnuals: YahooAnnualSnapshot[];
  asOf?: Date;
  recheckAfterDays?: number;
}): FundamentalsFreshnessDecision {
  const asOf = args.asOf ?? new Date();
  const recheckAfterDays = args.recheckAfterDays ?? DAILY_FUNDAMENTALS_RECHECK_DAYS;
  const annuals = [...args.yahooAnnuals].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  if (annuals.length === 0) {
    return {
      needsRefresh: true,
      reason: "no_yahoo_annuals",
      latestPeriodEnd: null,
      latestRetrievedAt: null,
      recheckAfterDays,
      daysSinceRetrieved: null,
    };
  }

  const latest = annuals[0]!;
  const items = parseLineItemsJson(latest.lineItemsJson);
  if (!latestAnnualIsFull(items)) {
    return {
      needsRefresh: true,
      reason: "incomplete_latest",
      latestPeriodEnd: latest.periodEnd,
      latestRetrievedAt: latest.retrievedAt,
      recheckAfterDays,
      daysSinceRetrieved: utcCalendarDaysBetween(latest.retrievedAt, asOf),
    };
  }

  const newestRetrieved = annuals.reduce(
    (best, row) => (row.retrievedAt > best ? row.retrievedAt : best),
    annuals[0]!.retrievedAt,
  );
  const daysSinceRetrieved = utcCalendarDaysBetween(newestRetrieved, asOf);
  if (daysSinceRetrieved === null || daysSinceRetrieved >= recheckAfterDays) {
    return {
      needsRefresh: true,
      reason: "recheck_due",
      latestPeriodEnd: latest.periodEnd,
      latestRetrievedAt: newestRetrieved,
      recheckAfterDays,
      daysSinceRetrieved,
    };
  }

  return {
    needsRefresh: false,
    reason: "fresh_complete",
    latestPeriodEnd: latest.periodEnd,
    latestRetrievedAt: newestRetrieved,
    recheckAfterDays,
    daysSinceRetrieved,
  };
}
