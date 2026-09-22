import { formatMyr } from "@/lib/format-myr";
import type { MetricValue } from "@/metrics/types";

export function formatMetricValue(metric: MetricValue): string {
  if (metric.id === "last_trade_date") {
    return metric.period?.trim() ? metric.period : "Unavailable";
  }
  if (!metric.available || metric.value === null || !Number.isFinite(metric.value)) {
    return metric.reason?.trim() ? `Unavailable — ${metric.reason}` : "Unavailable";
  }
  if (metric.unit === "myr") {
    return formatMyr(metric.value);
  }
  if (metric.unit === "percent" || metric.id.endsWith("_cagr") || metric.id.includes("margin") || metric.id === "roe" || metric.id.startsWith("distance_")) {
    return `${(metric.value * 100).toFixed(1)}%`;
  }
  return metric.value.toFixed(4);
}
