/** Dates that must stay visible so a live score run is not mistaken for a new filing year. */

export type SnapshotDates = {
  score_as_of: string;
  last_trade_date: string | null;
  fundamentals_period: string | null;
  lag_note: string;
};

export function latestAnnualPeriod(
  periods: { periodEnd: string; statementType: string }[],
): string | null {
  return latestAnnualObservation(periods)?.periodEnd ?? null;
}

export function latestAnnualObservation(
  periods: { periodEnd: string; availableAt?: string | null; statementType: string }[],
): { periodEnd: string; availableAt: string | null } | null {
  const annuals = periods
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const row = annuals[0] ?? [...periods].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  if (!row) return null;
  return { periodEnd: row.periodEnd, availableAt: row.availableAt ?? null };
}

export function buildSnapshotDates(args: {
  scoreAsOf: string;
  lastTradeDate: string | null;
  fundamentalsPeriod: string | null;
}): SnapshotDates {
  const fundamentals_period = args.fundamentalsPeriod;
  const last_trade_date = args.lastTradeDate;
  const fy = fundamentals_period?.slice(0, 4) ?? null;
  const lag_note =
    fy === null
      ? "No stored annual filing period. Missing fundamentals are Data unavailable — later calendar years are not invented."
      : `Stored annual fundamentals end ${fundamentals_period} (FY${fy}). Price as-of / last trade is ${last_trade_date ?? "Data unavailable"}. Score run ${args.scoreAsOf.slice(0, 10)}. P/E and growth use those filings, not invented FY${Number(fy) + 1}/${Number(fy) + 2} numbers.`;
  return {
    score_as_of: args.scoreAsOf,
    last_trade_date,
    fundamentals_period,
    lag_note,
  };
}
