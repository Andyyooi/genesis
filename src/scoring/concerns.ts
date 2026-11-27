import type { ScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import type { ConcernHit } from "@/scoring/types";

export function warningPenaltyPoints(hits: ConcernHit[]): number {
  return Math.min(25, hits.reduce((total, hit) => total + (hit.penaltyPoints ?? 0), 0));
}

export function evaluateConcerns(args: {
  config: ScoringConfig;
  metrics: MetricValue[];
  pn17: boolean;
  researchProfile: ResearchProfile;
}): ConcernHit[] {
  const hits: ConcernHit[] = [];
  for (const rule of args.config.concerns.rules) {
    if (rule.excluded_profiles?.includes(args.researchProfile)) continue;
    const penalty = args.config.concerns.apply_score_penalty && rule.penalty_points
      ? { penaltyPoints: rule.penalty_points } : {};
    if (rule.when === "instrument_pn17") {
      if (args.pn17) {
        hits.push({
          id: rule.id,
          label: rule.label,
          message: rule.message,
          metricId: null,
          value: null,
          period: null,
          ...penalty,
        });
      }
      continue;
    }
    if (!rule.metric || rule.threshold === undefined) continue;
    const metric = args.metrics.find((row) => row.id === rule.metric);
    if (!metric?.available || metric.value === null || !Number.isFinite(metric.value)) continue;
    const fired =
      rule.when === "value_lt" ? metric.value < rule.threshold : metric.value > rule.threshold;
    if (fired) {
      hits.push({
        id: rule.id,
        label: rule.label,
        message: rule.message,
        metricId: rule.metric,
        value: metric.value,
        period: metric.period,
        ...penalty,
      });
    }
  }
  return hits;
}
