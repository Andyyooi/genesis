import { available, unavailable, type MetricInput, type MetricValue, type MetricUnit } from "@/metrics/types";

/**
 * Compound annual growth: (end/start)^(1/years) - 1.
 * Undefined if years <= 0, start <= 0, or either side is missing (negative bases are not invented).
 */
export function cagr(
  id: string,
  label: string,
  start: number | null | undefined,
  end: number | null | undefined,
  years: number,
  formula: string,
  inputs: MetricInput[],
  period: string | null,
  unit: MetricUnit = "ratio",
): MetricValue {
  if (start === null || start === undefined || end === null || end === undefined) {
    return unavailable(id, label, formula, "Start or end value is unavailable", inputs, period, unit);
  }
  if (years <= 0) {
    return unavailable(id, label, formula, "CAGR needs a positive year span", inputs, period, unit);
  }
  if (start <= 0) {
    return unavailable(
      id,
      label,
      formula,
      "CAGR is undefined when the start value is zero or negative",
      inputs,
      period,
      unit,
    );
  }
  return available(id, label, Math.pow(end / start, 1 / years) - 1, unit, formula, inputs, period);
}
