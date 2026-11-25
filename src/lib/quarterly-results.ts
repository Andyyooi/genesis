import type { StatementSnapshot } from "@/metrics/types";

export const QUARTERLY_ALERT_WINDOW_DAYS = 120;

export type QuarterlyResultComparison = {
  periodEnd: string;
  reportedDate: string | null;
  priorPeriodEnd: string | null;
  profit: number | null;
  priorProfit: number | null;
  profitChangePct: number | null;
  debt: number | null;
  priorDebt: number | null;
  debtChangePct: number | null;
  summary: string;
};

function dayMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const iso = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatCompactMyr(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}RM ${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}RM ${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}RM ${(abs / 1e3).toFixed(0)}K`;
  return `${sign}RM ${abs.toFixed(0)}`;
}

function pctChange(current: number | null, prior: number | null): number | null {
  if (!finite(current) || !finite(prior) || prior <= 0) return null;
  return (current - prior) / prior;
}

function describeProfit(current: number | null, prior: number | null): string {
  if (!finite(current)) return "Profit unavailable";
  const nowText = formatCompactMyr(current);
  if (!finite(prior)) return `Profit ${nowText} (last year unavailable)`;
  const priorText = formatCompactMyr(prior);
  if (prior <= 0 && current > 0) return `Profit ${nowText} (turned profitable vs ${priorText} a year earlier)`;
  if (prior > 0 && current <= 0) return `Loss of ${formatCompactMyr(Math.abs(current))} (down from ${priorText} profit a year earlier)`;
  if (prior < 0 && current < 0) return `Loss of ${formatCompactMyr(Math.abs(current))} (vs loss of ${formatCompactMyr(Math.abs(prior))} a year earlier)`;
  if (prior === 0) return `Profit ${nowText} (vs RM 0 a year earlier)`;
  const pct = Math.round(((current - prior) / prior) * 100);
  const direction = pct > 0 ? `up ${pct}%` : pct < 0 ? `down ${Math.abs(pct)}%` : "unchanged";
  return `Profit ${nowText} (${direction} vs ${priorText} a year earlier)`;
}

function describeDebt(current: number | null, prior: number | null): string {
  if (!finite(current)) return "Debt unavailable";
  const nowText = formatCompactMyr(current);
  if (!finite(prior)) return `Debt ${nowText} (last year unavailable)`;
  const priorText = formatCompactMyr(prior);
  if (prior === 0 && current === 0) return "No debt reported (same as a year earlier)";
  if (prior === 0) return `Debt ${nowText} (up from RM 0 a year earlier)`;
  const pct = Math.round(((current - prior) / prior) * 100);
  const direction = pct > 0 ? `up ${pct}%` : pct < 0 ? `down ${Math.abs(pct)}%` : "unchanged";
  return `Debt ${nowText} (${direction} vs ${priorText} a year earlier)`;
}

/**
 * Find the latest actual quarterly result within `windowDays` of `referenceDate`
 * and compare its profit and debt against the same quarter a year earlier.
 */
export function latestQuarterlyResultAlert(
  periods: StatementSnapshot[],
  referenceDate: string | null,
  windowDays = QUARTERLY_ALERT_WINDOW_DAYS,
): QuarterlyResultComparison | null {
  const quarters = periods
    .filter((row) => row.statementType === "quarterly")
    .filter((row) => finite(row.pat) || finite(row.totalDebt))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const latest = quarters[0];
  if (!latest) return null;

  const refMs = dayMs(referenceDate);
  const latestEventMs = dayMs(latest.availableAt) ?? dayMs(latest.periodEnd);
  if (refMs !== null && latestEventMs !== null) {
    const ageDays = (refMs - latestEventMs) / 86_400_000;
    if (ageDays > windowDays || ageDays < -31) return null;
  }

  const latestEndMs = dayMs(latest.periodEnd);
  let prior: StatementSnapshot | null = null;
  if (latestEndMs !== null) {
    let bestDiff = Infinity;
    for (const candidate of quarters.slice(1)) {
      const candidateMs = dayMs(candidate.periodEnd);
      if (candidateMs === null) continue;
      const gapDays = (latestEndMs - candidateMs) / 86_400_000;
      if (gapDays >= 330 && gapDays <= 400) {
        const diff = Math.abs(gapDays - 365);
        if (diff < bestDiff) {
          bestDiff = diff;
          prior = candidate;
        }
      }
    }
  }

  const profit = finite(latest.pat) ? latest.pat : null;
  const priorProfit = prior && finite(prior.pat) ? prior.pat : null;
  const debt = finite(latest.totalDebt) ? latest.totalDebt : null;
  const priorDebt = prior && finite(prior.totalDebt) ? prior.totalDebt : null;
  const summary = `Quarter ended ${latest.periodEnd}: ${describeProfit(profit, priorProfit)}. ${describeDebt(debt, priorDebt)}.`;

  return {
    periodEnd: latest.periodEnd,
    reportedDate: latest.availableAt ? latest.availableAt.slice(0, 10) : null,
    priorPeriodEnd: prior?.periodEnd ?? null,
    profit,
    priorProfit,
    profitChangePct: pctChange(profit, priorProfit),
    debt,
    priorDebt,
    debtChangePct: pctChange(debt, priorDebt),
    summary,
  };
}
