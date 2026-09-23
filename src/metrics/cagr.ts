import { available, unavailable, type MetricInput, type MetricValue, type MetricUnit } from "@/metrics/types";

/**
 * Compound annual growth: (end/start)^(1/years) - 1.
 * Undefined if years <= 0, start <= 0, end <= 0, either side is missing,
 * or the ratio is non-positive (negative bases are not invented).
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(years)) {
    return unavailable(id, label, formula, "Start, end, or year span is not a finite number", inputs, period, unit);
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
  if (end <= 0) {
    return unavailable(
      id,
      label,
      formula,
      "CAGR is undefined when the end value is zero or negative (sign change or non-positive end)",
      inputs,
      period,
      unit,
    );
  }
  const ratio = end / start;
  if (!(ratio > 0) || !Number.isFinite(ratio)) {
    return unavailable(
      id,
      label,
      formula,
      "CAGR is undefined when end/start is non-positive or non-finite",
      inputs,
      period,
      unit,
    );
  }
  const value = Math.pow(ratio, 1 / years) - 1;
  if (!Number.isFinite(value)) {
    return unavailable(
      id,
      label,
      formula,
      "CAGR calculation did not produce a finite number",
      inputs,
      period,
      unit,
    );
  }
  return available(id, label, value, unit, formula, inputs, period);
}
