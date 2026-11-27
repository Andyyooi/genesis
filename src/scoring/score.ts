import { CATEGORY_KEYS, getFactorProfile, profileName, resolveResearchProfile, type ScoringConfig } from "@/config/load-scoring";
import type { MetricValue, PriceBarSnapshot } from "@/metrics/types";
import { isInsuranceIndustry, type ResearchProfile } from "@/research/profiles";
import { assessDataQuality } from "@/scoring/confidence";
import { evaluateConcerns, warningPenaltyPoints } from "@/scoring/concerns";
import { assessEligibility } from "@/scoring/eligibility";
import { hashScoringConfig } from "@/scoring/hash";
import { scoreFactor } from "@/scoring/map-factor";
import { rankCrossSection, type PercentileEvidence } from "@/scoring/rank";
import type { CategoryScore, ScoreResult } from "@/scoring/types";
import { emptyValuationContext } from "@/scoring/valuation-context";

export type ScoreInput = {
  config: ScoringConfig; metrics: MetricValue[]; instrumentType: "COMMON_STOCK" | "REIT";
  ticker?: string | null; sector?: string | null; industry?: string | null; researchProfile?: ResearchProfile | null;
  pn17?: boolean; warning?: boolean; asOf?: string; bars?: PriceBarSnapshot[];
  latestAnnual?: { periodEnd: string; availableAt: string | null } | null;
};

function scoreProfile(input: ScoreInput, researchProfile: ResearchProfile) {
  const hints = { sector: input.sector, industry: input.industry, explicit: researchProfile };
  const profile = getFactorProfile(input.config, input.instrumentType, input.ticker, hints);
  const insurer = researchProfile === "OTHER_FINANCIAL" && isInsuranceIndustry(input.industry);
  const factorSets = insurer ? { ...profile.factor_sets, financial_health: input.config.insurer_health_factors } : profile.factor_sets;
  return { profile, factorSets, insurer };
}

export function scoreFromMetrics(args: ScoreInput, ranks: Map<string, PercentileEvidence> = new Map()): ScoreResult {
  const classified = resolveResearchProfile(args.instrumentType, args.ticker, { sector: args.sector, industry: args.industry, explicit: args.researchProfile }, args.config);
  const hints = { sector: args.sector, industry: args.industry, explicit: classified.profile };
  const { profile, factorSets, insurer } = scoreProfile(args, classified.profile);
  const weights = profile.category_weights ?? args.config.category_weights;
  const asOf = args.asOf ?? new Date().toISOString();
  const categories: CategoryScore[] = CATEGORY_KEYS.map((id) => {
    const factors = factorSets[id].map((factor) => ({ ...scoreFactor(factor, args.metrics, ranks.get(factor.metric)), category: id }));
    const live = factors.filter((f) => f.available && f.score !== null);
    const totalFactorWeights = factors.reduce((sum, f) => sum + f.weight, 0);
    const availableFactorWeights = live.reduce((sum, f) => sum + f.weight, 0);
    const coverage = totalFactorWeights ? availableFactorWeights / totalFactorWeights : 0;
    const incompleteInsurerHealth = insurer && id === "financial_health" && live.length < factors.length;
    const score = availableFactorWeights && !incompleteInsurerHealth ? live.reduce((sum, f) => sum + f.score! * f.weight, 0) / availableFactorWeights : null;
    return { id, configuredWeight: weights[id], liveWeight: null, score, coverage, availableFactorWeights, totalFactorWeights, inThisRun: false, factors,
      warning: incompleteInsurerHealth ? "Both insurer health checks are required; financial health is not scored." : score === null ? "No available ranked evidence; category excluded, not zero." : coverage < args.config.min_category_coverage ? "Thin factor coverage; remaining evidence renormalized." : null };
  });
  const live = categories.filter((c) => c.score !== null && c.configuredWeight > 0);
  const liveWeight = live.reduce((sum, c) => sum + c.configuredWeight, 0);
  for (const category of live) { category.inThisRun = true; category.liveWeight = category.configuredWeight / liveWeight; }
  const scoreBefore = liveWeight ? live.reduce((sum, c) => sum + c.score! * c.liveWeight!, 0) : null;
  const concerns = evaluateConcerns({ config: args.config, metrics: args.metrics, pn17: args.pn17 ?? false, researchProfile: classified.profile });
  const points = warningPenaltyPoints(concerns);
  const researchScore = scoreBefore === null ? null : Math.max(0, scoreBefore - points);
  const valuationScore = categories.find((c) => c.id === "valuation")?.score ?? null;
  const quality = assessDataQuality({ asOf, researchProfile: classified.profile, categories, researchScore, valuationScore, latestAnnual: args.latestAnnual, config: args.config });
  return {
    methodology: "cross-sectional-v2", asOf, configHash: hashScoringConfig(args.config), profile: profileName(args.instrumentType, args.ticker, hints, args.config),
    researchProfile: classified.profile, researchProfileReason: classified.reason, researchScore, valuationScore, categories,
    ...quality, eligibility: assessEligibility({ pn17: args.pn17 ?? false, warning: args.warning, coverage: quality.dataCoverage.coverageRatio, bars: args.bars ?? [], config: args.config, asOf }),
    concerns,
    ...(scoreBefore !== null && points > 0 ? { warningPenalty: { scoreBefore, points } } : {}),
    notes: ["Percentiles computed together across the stored listed universe; banks and REITs have separate rank groups.", `Sector blend ${(args.config.ranking.sector_blend * 100).toFixed(0)}%; fallback to profile-wide below ${args.config.ranking.sector_min_names} available names. Ties use average ranks; singleton 50.`, `Accounts usable at known available_at, else FY end plus ${args.config.reporting_lag_months} months. News and generic technicals never affect scores.`, "Missing factors/categories are omitted and remaining weights renormalized. Eligibility is separate from score."],
    valuationContext: emptyValuationContext("Historical and peer valuation context is separate from cross-sectional scores."),
  };
}

/** The only production score computation: rank every listed company in one cross-section. */
export function scoreUniverse(inputs: ScoreInput[]): Map<string, ScoreResult> {
  const prepared = inputs.map((input) => {
    const classified = resolveResearchProfile(input.instrumentType, input.ticker, { sector: input.sector, industry: input.industry, explicit: input.researchProfile }, input.config);
    const { factorSets } = scoreProfile(input, classified.profile);
    return { input, group: classified.factorSet, factors: Object.values(factorSets).flat() };
  });
  const ranks = new Map<string, Map<string, PercentileEvidence>>();
  for (const metricId of new Set(prepared.flatMap((p) => p.factors.map((f) => f.metric)))) {
    const rows = prepared.filter((p) => p.factors.some((f) => f.metric === metricId));
    const ranked = rankCrossSection(rows.map(({ input, group }) => {
      const metric = input.metrics.find((m) => m.id === metricId);
      return { ticker: input.ticker!, group, sector: input.sector ?? null, value: metric?.available ? metric.value : null };
    }), rows[0].factors.find((f) => f.metric === metricId)!.direction === "lower_better", inputs[0].config.ranking.sector_min_names, inputs[0].config.ranking.sector_blend);
    for (const [ticker, rank] of ranked) {
      if (!ranks.has(ticker)) ranks.set(ticker, new Map());
      ranks.get(ticker)!.set(metricId, rank);
    }
  }
  return new Map(inputs.map((input) => [input.ticker!, scoreFromMetrics(input, ranks.get(input.ticker!))]));
}
