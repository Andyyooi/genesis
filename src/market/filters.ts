import type { ListFairRange } from "@/lib/fair-range-summary";

export const STRONG_RESEARCH_SCORE = 60;

export function filterMarketRows<T extends Record<string, unknown>>(rows: T[], query = "", eligibility = "", options: {
  belowFairRange?: boolean;
  fairRanges?: Record<string, ListFairRange>;
} = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    const range = options.fairRanges?.[String(row.ticker)];
    return (!q || [row.ticker, row.name, row.sector].some((value) => String(value ?? "").toLowerCase().includes(q))) &&
      (eligibility === "eligible" ? row.eligible === true : eligibility === "excluded" ? row.eligible !== true : true) &&
      (!options.belowFairRange || (row.eligible === true && row.insufficient !== true &&
        typeof row.researchScore === "number" && Number.isFinite(row.researchScore) && row.researchScore >= STRONG_RESEARCH_SCORE &&
        range?.available === true && range.position === "below"));
  });
}
