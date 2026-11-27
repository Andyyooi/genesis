export const TRAILING_DIVIDEND_BASIS = "Last 12 months (by ex-dividend date)";

export type DividendEvent = { exDate: string; amount: number };
export type DividendCoverage = { from: string; through: string; events: DividendEvent[] };
export type DividendBasis = { perShare: number; label: string; date: string };

export function offsetDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function fullYearDividendLabel(periodEnd: string, fiscalYear?: number | null): string {
  return `FY${fiscalYear ?? periodEnd.slice(0, 4)} full year`;
}

export function selectDividend(
  coverage: DividendCoverage | null | undefined,
  priceDate: string | null | undefined,
  annuals: readonly { periodEnd: string; fiscalYear?: number | null; dividendPerShare: number | null }[],
): DividendBasis | null {
  if (coverage && priceDate) {
    const start = offsetDays(priceDate, -365);
    if (coverage.from <= start && coverage.through >= offsetDays(priceDate, -1)) {
      const perShare = coverage.events
        .filter(({ exDate }) => exDate >= start && exDate < priceDate)
        .reduce((total, { amount }) => total + amount, 0);
      return { perShare, label: TRAILING_DIVIDEND_BASIS, date: priceDate };
    }
  }
  const annual = annuals.find(({ dividendPerShare }) => dividendPerShare !== null &&
    Number.isFinite(dividendPerShare) && dividendPerShare >= 0);
  return annual?.dividendPerShare != null
    ? { perShare: annual.dividendPerShare, label: fullYearDividendLabel(annual.periodEnd, annual.fiscalYear), date: annual.periodEnd }
    : null;
}

export function reportedDividend<T extends { source: string; dividendPerShare: number | null }>(row: T): T {
  // Legacy quote-summary rows stored a single Yahoo payment, not the full-year total.
  return row.source === "yahoo-quote-summary" ? { ...row, dividendPerShare: null } : row;
}
