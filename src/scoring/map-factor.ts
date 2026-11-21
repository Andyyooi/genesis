import type { FactorConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import type { PercentileEvidence } from "@/scoring/rank";
import type { FactorEvidence } from "@/scoring/types";

export function scoreFactor(factor: FactorConfig, metrics: MetricValue[], rank?: PercentileEvidence): FactorEvidence {
  const metric = metrics.find((row) => row.id === factor.metric);
  const available = Boolean(metric?.available && metric.value !== null && Number.isFinite(metric.value) && rank);
  return {
    id: factor.id, label: factor.label, explanation: factor.explanation, category: "", weight: factor.weight, metricId: factor.metric,
    value: metric?.value ?? null, score: available ? rank!.blended : null, available,
    reason: available ? null : metric?.reason ?? "No stored universe percentile; run market:rescore.",
    period: metric?.period ?? null, formula: metric?.formula ?? factor.explanation, inputs: metric?.inputs ?? [], percentile: rank,
    notes: rank ? `Profile-wide percentile ${rank.market.toFixed(1)} (${rank.marketCount} names); sector percentile ${rank.sector.toFixed(1)} (${rank.sectorCount} names)${rank.sectorFallback ? "; sector too small/unknown, profile-wide fallback" : ""}. Higher percentile is better after direction adjustment.` : null,
  };
}
