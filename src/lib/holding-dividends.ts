import { parseLineItemsJson } from "@/ingest/merge-line-items";

export type AnnualDividend = { perShare: number; date: string; basis: "annual-accounts" | "calendar-yield" };

type Period = { periodEnd: string; statementType: string; actualOrEstimate: string; lineItemsJson: string | null; source: string };

export function annualDividend(
  currency: string,
  periods: readonly Period[],
  price: number | null,
  calendar?: { annualYieldPercent: number | null; checkedAt: string },
): AnnualDividend | null {
  if (currency !== "MYR") return null;
  const yieldPercent = calendar?.annualYieldPercent;
  if (calendar && yieldPercent != null && Number.isFinite(yieldPercent) && yieldPercent >= 0 &&
      price !== null && Number.isFinite(price) && price > 0) {
    const perShare = price * (yieldPercent / 100);
    if (Number.isFinite(perShare)) return { perShare, date: calendar.checkedAt.slice(0, 10), basis: "calendar-yield" };
  }

  // Older Yahoo quote-summary imports put a single payment in the annual row.
  const annuals = periods
    .filter(row => row.statementType === "annual" && row.actualOrEstimate === "actual" && row.source !== "yahoo-quote-summary")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  for (const row of annuals) {
    const { dividendPerShare } = parseLineItemsJson(row.lineItemsJson);
    if (dividendPerShare !== null && Number.isFinite(dividendPerShare) && dividendPerShare >= 0) {
      return { perShare: dividendPerShare, date: row.periodEnd, basis: "annual-accounts" };
    }
  }
  return null;
}
