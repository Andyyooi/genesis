import type { ScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import type { ConcernHit } from "@/scoring/types";

export function evaluateConcerns(args: {
  config: ScoringConfig;
  metrics: MetricValue[];
  pn17: boolean;
}): ConcernHit[] {
  const hits: ConcernHit[] = [];
  for (const rule of args.config.concerns.rules) {
    if (rule.when === "instrument_pn17") {
      if (args.pn17) {
        hits.push({
          id: rule.id,
          label: rule.label,
          message: rule.message,
          metricId: null,
          value: null,
          period: null,
        });
      }
      continue;
    }
    if (!rule.metric || rule.threshold === undefined) continue;
    const metric = args.metrics.find((row) => row.id === rule.metric);
    if (!metric?.available || metric.value === null) continue;
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
      });
    }
  }
  return hits;
}
