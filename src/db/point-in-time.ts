/** Fiscal label beside period_end. Not a publication date. */
export function fiscalPeriodLabel(args: {
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodEnd: string;
  statementType: string;
}): string {
  const year = args.fiscalYear ?? Number(args.periodEnd.slice(0, 4));
  const fy = Number.isInteger(year) ? `FY${year}` : args.periodEnd.slice(0, 7);
  if (args.statementType !== "annual" && args.fiscalQuarter) {
    return `Q${args.fiscalQuarter} ${fy}`;
  }
  return fy;
}

export type AvailabilityRow = {
  id?: number;
  instrumentId?: number;
  periodEnd: string;
  fiscalPeriod?: string | null;
  filingDate?: string | null;
  availableAt: string | null;
  retrievedAt?: string | null;
  source: string;
  statementType: string;
};

export type AvailabilityFlag = "KNOWN" | "UNKNOWN";

export function availabilityFlag(availableAt: string | null | undefined): AvailabilityFlag {
  return availableAt ? "KNOWN" : "UNKNOWN";
}

export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

/**
 * Point-in-time set: only rows an investor could have seen by asOf.
 * Null available_at is UNKNOWN and is never treated as already known.
 * retrieved_at is ignored.
 */
export function observationsKnownAsOf<T extends AvailabilityRow>(rows: T[], asOf: string): T[] {
  const asOfDay = isoDay(asOf);
  if (!asOfDay) return [];
  return rows
    .filter((row) => {
      const available = isoDay(row.availableAt);
      if (!available) return false;
      return available <= asOfDay;
    })
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.source.localeCompare(b.source));
}

export function latestObservationKnownAsOf<T extends AvailabilityRow>(
  rows: T[],
  asOf: string,
  statementType = "annual",
): T | null {
  const known = observationsKnownAsOf(
    statementType ? rows.filter((row) => row.statementType === statementType) : rows,
    asOf,
  );
  return known[0] ?? null;
}

export type HistoricalValuationStatus = "POINT_IN_TIME_SAFE" | "PERIOD_END_ONLY" | "UNAVAILABLE";

export function historicalValuationStatus(args: {
  pointCount: number;
  allPointsHaveAvailableAt: boolean;
}): HistoricalValuationStatus {
  if (args.pointCount === 0) return "UNAVAILABLE";
  if (args.allPointsHaveAvailableAt) return "POINT_IN_TIME_SAFE";
  return "PERIOD_END_ONLY";
}
