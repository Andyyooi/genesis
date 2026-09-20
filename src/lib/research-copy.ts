import type { CategoryScore, FactorEvidence, ScoreResult } from "@/scoring/types";

export const CATEGORY_LABELS: Record<string, string> = {
  valuation: "Valuation",
  quality: "Business Quality",
  financial_health: "Financial Health",
  growth: "Growth",
  news: "News / Catalysts",
  technical: "Market / Technical",
};

export function formatScore100(value: number | null): string {
  if (value === null) return "Data unavailable";
  return `${value.toFixed(0)}/100`;
}

export function strongestPositives(result: ScoreResult, limit = 4): FactorEvidence[] {
  return result.categories
    .flatMap((c) => c.factors.map((f) => ({ ...f, category: c.id })))
    .filter((f) => f.available && f.score !== null && f.score >= 60)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export function scoreNarrative(result: ScoreResult): string {
  const quality = result.categories.find((c) => c.id === "quality")?.score;
  const valuation = result.valuationScore;
  const growth = result.categories.find((c) => c.id === "growth")?.score;
  const qualityBit =
    quality === null || quality === undefined
      ? "quality is not scored this run"
      : quality >= 70
        ? "quality looks relatively strong"
        : quality >= 45
          ? "quality is mixed"
          : "quality looks relatively weak";
  const valueBit =
    valuation === null
      ? "valuation is not scored this run"
      : valuation >= 70
        ? "the price looks relatively attractive"
        : valuation >= 45
          ? "the price looks neither cheap nor demanding"
          : "the price looks relatively expensive";
  const growthBit =
    growth === null || growth === undefined
      ? "growth is not scored this run"
      : growth >= 70
        ? "historical growth is relatively strong"
        : growth >= 45
          ? "historical growth is moderate"
          : "historical growth is relatively weak";
  const profileBit =
    result.profile === "reit"
      ? "This name is scored with the REIT factor profile (distribution yield, book NAV, DPU CAGR, gearing) — not industrial FCF or EV/EBITDA."
      : result.profile === "bank"
        ? "This name is scored with the bank overlay (P/B and ROE). Industrial FCF and EV/EBITDA are not scoring factors."
        : "This name is scored with the ordinary-company factor profile.";
  return `${profileBit} ${qualityBit[0].toUpperCase()}${qualityBit.slice(1)}; ${valueBit}; ${growthBit}. These are research observations, not a buy or sell.`;
}

export function categoryTitle(category: CategoryScore): string {
  return CATEGORY_LABELS[category.id] ?? category.id;
}
