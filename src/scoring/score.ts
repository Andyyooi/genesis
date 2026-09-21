import {
  CATEGORY_KEYS,
  getFactorProfile,
  profileName,
  resolveResearchProfile,
  type CategoryKey,
  type ScoringConfig,
} from "@/config/load-scoring";
import type { ResearchProfile } from "@/research/profiles";
import type { MetricValue } from "@/metrics/types";
import { assessDataQuality } from "@/scoring/confidence";
import { evaluateConcerns } from "@/scoring/concerns";
import { hashScoringConfig } from "@/scoring/hash";
import { scoreFactor } from "@/scoring/map-factor";
import type { CategoryScore, ScoreResult } from "@/scoring/types";

function categoryAverage(factors: { score: number | null; weight: number; available: boolean }[]): {
  score: number | null;
  coverage: number;
  availableWeight: number;
  totalWeight: number;
} {
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const available = factors.filter((f) => f.available && f.score !== null);
  const availableWeight = available.reduce((sum, f) => sum + f.weight, 0);
  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight;
  if (availableWeight === 0) {
    return { score: null, coverage, availableWeight, totalWeight };
  }
  const score = available.reduce((sum, f) => sum + (f.score as number) * f.weight, 0) / availableWeight;
  return { score, coverage, availableWeight, totalWeight };
}

export function scoreFromMetrics(args: {
  config: ScoringConfig;
  metrics: MetricValue[];
  instrumentType: "COMMON_STOCK" | "REIT";
  ticker?: string | null;
  sector?: string | null;
  industry?: string | null;
  researchProfile?: ResearchProfile | null;
  pn17?: boolean;
  asOf?: string;
  /** Latest annual filing clock. available_at if known, else period_end. Never retrieved_at. */
  latestAnnual?: { periodEnd: string; availableAt: string | null } | null;
}): ScoreResult {
  const classified = resolveResearchProfile(
    args.instrumentType,
    args.ticker,
    { sector: args.sector, industry: args.industry, explicit: args.researchProfile },
    args.config,
  );
  const hints = {
    sector: args.sector,
    industry: args.industry,
    explicit: classified.profile,
  };
  const profile = getFactorProfile(args.config, args.instrumentType, args.ticker, hints);
  const name = profileName(args.instrumentType, args.ticker, hints, args.config);
  const asOf = args.asOf ?? new Date().toISOString();
  const notes: string[] = [];

  const categories: CategoryScore[] = CATEGORY_KEYS.map((key) => {
    const configuredWeight = args.config.category_weights[key];
    const blocked = args.config.unavailable_until_data.includes(key);
    const factors = profile.factor_sets[key].map((factor) => {
      const evidence = scoreFactor(factor, args.metrics);
      return { ...evidence, category: key };
    });
    const avg = categoryAverage(factors);
    const belowMin =
      !blocked && avg.totalWeight > 0 && avg.coverage < args.config.min_category_coverage;
    let warning: string | null = null;
    if (blocked) {
      warning = `Configured ${configuredWeight}% is not in this run (no ${key} data yet). Remaining weights are renormalized.`;
    } else if (avg.totalWeight === 0) {
      warning = "No factors in this profile for this category.";
    } else if (avg.score === null) {
      warning = "No available factors — omitted from the Research Score (not scored as zero).";
    } else if (belowMin) {
      warning = `Coverage ${(avg.coverage * 100).toFixed(0)}% is below min ${(args.config.min_category_coverage * 100).toFixed(0)}%. Score is shown with this warning.`;
    }
    return {
      id: key,
      configuredWeight,
      liveWeight: null,
      score: blocked ? null : avg.score,
      coverage: blocked ? 0 : avg.coverage,
      availableFactorWeights: avg.availableWeight,
      totalFactorWeights: avg.totalWeight,
      inThisRun: false,
      warning,
      factors,
    };
  });

  const live = categories.filter(
    (c) =>
      !args.config.unavailable_until_data.includes(c.id as CategoryKey) && c.score !== null,
  );
  const liveWeightSum = live.reduce((sum, c) => sum + c.configuredWeight, 0);
  for (const category of categories) {
    const included = live.some((c) => c.id === category.id);
    category.inThisRun = included;
    category.liveWeight = included && liveWeightSum > 0 ? category.configuredWeight / liveWeightSum : null;
  }

  const researchScore =
    liveWeightSum === 0
      ? null
      : live.reduce((sum, c) => sum + (c.score as number) * (c.configuredWeight / liveWeightSum), 0);

  const valuation = categories.find((c) => c.id === "valuation");
  const valuationScore = valuation?.score ?? null;

  notes.push(
    `Research profile ${classified.profile} (${classified.reason}) Factor set ${classified.factorSet}.`,
  );
  if (args.config.unavailable_until_data.length) {
    notes.push(
      `${args.config.unavailable_until_data
        .map((k) => `${k} ${args.config.category_weights[k]}%`)
        .join(", ")} configured but not in this live run.`,
    );
  }
  const newsCat = categories.find((c) => c.id === "news");
  if (newsCat && !newsCat.inThisRun && !args.config.unavailable_until_data.includes("news")) {
    notes.push(
      "News 10% is omitted until stored announcements exist; it is not scored as a neutral 50.",
    );
  }
  if (args.config.concerns.apply_score_penalty) {
    notes.push("Config asks for a concern penalty; Phase 4 still keeps concerns separate.");
  } else {
    notes.push("Potential Concerns do not change the Research Score.");
  }

  const concerns = evaluateConcerns({
    config: args.config,
    metrics: args.metrics,
    pn17: args.pn17 ?? false,
  });

  const { dataCoverage, dataConfidence } = assessDataQuality({
    asOf,
    categories,
    researchScore,
    valuationScore,
    latestAnnual: args.latestAnnual,
  });

  return {
    asOf,
    configHash: hashScoringConfig(args.config),
    profile: name,
    researchProfile: classified.profile,
    researchProfileReason: classified.reason,
    researchScore,
    valuationScore,
    categories,
    concerns,
    notes,
    dataCoverage,
    dataConfidence,
  };
}
