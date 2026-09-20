import { available, unavailable, type MetricInput, type MetricValue, type MetricUnit } from "@/metrics/types";

/** Divide only when both sides exist and the denominator is not zero. Never coerce missing to 0. */
export function safeDivide(
  id: string,
  label: string,
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  formula: string,
  inputs: MetricInput[],
  period: string | null,
  unit: MetricUnit = "ratio",
  extraUnavailable?: string,
): MetricValue {
  if (extraUnavailable) {
    return unavailable(id, label, formula, extraUnavailable, inputs, period, unit);
  }
  if (numerator === null || numerator === undefined) {
    return unavailable(id, label, formula, "Numerator is unavailable", inputs, period, unit);
  }
  if (denominator === null || denominator === undefined) {
    return unavailable(id, label, formula, "Denominator is unavailable", inputs, period, unit);
  }
  if (denominator === 0) {
    return unavailable(id, label, formula, "Division by zero", inputs, period, unit);
  }
  return available(id, label, numerator / denominator, unit, formula, inputs, period);
}
