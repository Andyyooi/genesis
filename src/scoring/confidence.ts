import { freshnessBand, monthsBetween } from "@/scoring/freshness";
import type { CategoryScore, DataConfidence, DataCoverage } from "@/scoring/types";
import { loadScoringConfig, type ScoringConfig } from "@/config/load-scoring";
import type { ResearchProfile } from "@/research/profiles";

export const CORE_SCORE_CATEGORIES = ["valuation", "quality", "financial_health", "growth", "momentum", "low_volatility"] as const;

const NOT_APPLICABLE_FACTORS: Record<ResearchProfile, readonly string[]> = {
  GENERAL: [], BANK: [], REIT: [], UNKNOWN: [],
  OTHER_FINANCIAL: ["gross_profitability", "net_debt_to_ebitda", "interest_coverage"],
};

export function formatCoverageSummary(coverage: Omit<DataCoverage, "notApplicable"> & { notApplicable?: number }): string {
  const applicability = coverage.notApplicable ? ` that apply; ${coverage.notApplicable} don't apply to this kind of company` : "";
  return `Coverage ${Math.round(coverage.coverageRatio * 100)}% (${coverage.available} of ${coverage.expected} factors${applicability}). Missing evidence is excluded, never zero.`;
}

export function assessDataQuality(args: { asOf: string; researchProfile: ResearchProfile; categories: CategoryScore[]; researchScore: number | null; valuationScore: number | null; config?: ScoringConfig; latestAnnual?: { periodEnd: string; availableAt: string | null } | null }): { dataCoverage: DataCoverage; dataConfidence: DataConfidence } {
  const factors = args.categories.filter((c) => c.configuredWeight > 0).flatMap((c) => c.factors);
  const live = factors.filter((f) => f.available && f.score !== null);
  const notApplicable = factors.filter((f) => (!f.available || f.score === null) && NOT_APPLICABLE_FACTORS[args.researchProfile].includes(f.id)).length;
  const expected = factors.length - notApplicable;
  const ageMonths = args.latestAnnual ? monthsBetween(args.asOf, args.latestAnnual.periodEnd) : null;
  const freshness = freshnessBand(ageMonths);
  const coverageRatio = expected ? live.length / expected : 0;
  const settings = (args.config ?? loadScoringConfig()).confidence;
  const level = coverageRatio >= settings.high_coverage && ageMonths !== null && ageMonths < settings.high_max_age_months ? "HIGH" : coverageRatio >= settings.medium_coverage && ageMonths !== null && ageMonths < settings.medium_max_age_months ? "MEDIUM" : "LOW";
  const mix = { FRESH: 0, AGING: 0, STALE: 0, VERY_STALE: 0, UNKNOWN: 0 };
  for (const factor of live) {
    const date = factor.period?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    mix[freshnessBand(date ? monthsBetween(args.asOf, date) : null)]++;
  }
  const dataCoverage: DataCoverage = {
    expected, available: live.length, unavailable: expected - live.length, notApplicable, coverageRatio,
    freshCount: mix.FRESH, agingCount: mix.AGING, staleCount: mix.STALE, veryStaleCount: mix.VERY_STALE, unknownCount: mix.UNKNOWN,
    freshness, ageMonths, periodEnd: args.latestAnnual?.periodEnd ?? null, availableAt: args.latestAnnual?.availableAt ?? null,
  };
  return { dataCoverage, dataConfidence: { level, needsVerification: level === "LOW", reasons: [
    formatCoverageSummary(dataCoverage),
    `Accounts age: ${ageMonths === null ? "unknown" : `${ageMonths} months from fiscal period-end`}. Retrieval time does not make accounts fresher.`,
    `High requires at least ${settings.high_coverage * 100}% coverage and accounts under ${settings.high_max_age_months} months; Medium requires ${settings.medium_coverage * 100}% and under ${settings.medium_max_age_months} months; otherwise Low.`,
  ] } };
}
