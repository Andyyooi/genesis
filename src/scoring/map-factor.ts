import type { FactorConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import type { FactorEvidence } from "@/scoring/types";

/** Map a raw metric onto 0–100 using YAML worse/better anchors. Missing values are not scored as 0. */
export function linearScore(value: number, worse: number, better: number): number {
  if (worse === better) {
    return value === better ? 100 : 0;
  }
  const t = (value - worse) / (better - worse);
  return Math.min(100, Math.max(0, t * 100));
}

export function scoreFactor(factor: FactorConfig, metrics: MetricValue[]): FactorEvidence {
  const metric = metrics.find((row) => row.id === factor.metric);
  const notes = `direction ${factor.direction}; 0 at ${factor.worse}, 100 at ${factor.better}`;

  if (!metric || !metric.available || metric.value === null) {
    return {
      id: factor.id,
      label: factor.label,
      category: "",
      weight: factor.weight,
      metricId: factor.metric,
      value: metric?.value ?? null,
      score: null,
      available: false,
      reason: metric?.reason ?? `Metric ${factor.metric} is unavailable`,
      period: metric?.period ?? null,
      formula: metric?.formula ?? "config threshold map",
      inputs: metric?.inputs ?? [],
      notes,
    };
  }

  const score = linearScore(metric.value, factor.worse, factor.better);
  return {
    id: factor.id,
    label: factor.label,
    category: "",
    weight: factor.weight,
    metricId: factor.metric,
    value: metric.value,
    score,
    available: true,
    reason: null,
    period: metric.period,
    formula: `${metric.formula}. Score 0 at ${factor.worse}, 100 at ${factor.better} (${factor.direction}).`,
    inputs: metric.inputs,
    notes,
  };
}
