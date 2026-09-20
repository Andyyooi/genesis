import { formatMyr } from "@/lib/format-myr";
import type { MetricValue } from "@/metrics/types";

export function formatMetricValue(metric: MetricValue): string {
  if (metric.id === "last_trade_date") {
    return metric.period ?? "Data unavailable";
  }
  if (!metric.available || metric.value === null) {
    return "Data unavailable";
  }
  if (metric.unit === "myr") {
    return formatMyr(metric.value);
  }
  if (metric.unit === "percent" || metric.id.endsWith("_cagr") || metric.id.includes("margin") || metric.id === "roe" || metric.id.startsWith("distance_")) {
    return `${(metric.value * 100).toFixed(1)}%`;
  }
  return metric.value.toFixed(4);
}
