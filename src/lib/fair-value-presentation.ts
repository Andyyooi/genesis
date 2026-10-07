import { formatDateSafe, isFiniteNumber } from "@/lib/display";
import { formatMyr } from "@/lib/format-myr";
import { formatFreshnessBand } from "@/lib/research-copy";
import type { FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";

export const FAIR_VALUE_SECTION_DESCRIPTION =
  "A ringgit estimate from this profile’s relative valuation methods. It is not a score and not a recommendation.";

export const FAIR_VALUE_ONE_METHOD_RANGE = "Unavailable — only one method produced a value.";

export const FAIR_VALUE_UNAVAILABLE_CONFIDENCE =
  "No supported valuation method produced a value.";

const RECOMMENDATION_LANGUAGE =
  /\b(buy|sell|strong buy|target price|upside|downside|undervalued|overvalued)\b/i;

export function fairValueHasBase(result: FairValueResult): boolean {
  return isFiniteNumber(result.fairValueBase);
}

export function fairValueHeroText(result: FairValueResult): string {
  if (!fairValueHasBase(result)) return "Unavailable";
  return formatMyr(result.fairValueBase);
}

export function fairValueRangeText(result: FairValueResult): string | null {
  if (!fairValueHasBase(result)) return null;
  if (isFiniteNumber(result.fairValueLow) && isFiniteNumber(result.fairValueHigh)) {
    return `${formatMyr(result.fairValueLow)} – ${formatMyr(result.fairValueHigh)}`;
  }
  return FAIR_VALUE_ONE_METHOD_RANGE;
}

export function fairValuePriceUsedText(result: FairValueResult): string {
  if (!isFiniteNumber(result.currentPrice)) return "Unavailable";
  const date = formatDateSafe(result.valuationDate);
  if (date === "Unavailable") return formatMyr(result.currentPrice);
  return `${formatMyr(result.currentPrice)} · ${date}`;
}

/** Uses the stored difference. Does not recompute fair value. */
export function fairValueDifferenceText(difference: number | null): string {
  if (!isFiniteNumber(difference)) return "Unavailable";
  if (difference === 0) return "At the current price";
  const percent = `${Math.abs(difference * 100).toFixed(1)}%`;
  return difference > 0 ? `${percent} above the current price` : `${percent} below the current price`;
}

export function fairValueConfidenceText(result: FairValueResult): string {
  if (result.confidence === "UNAVAILABLE") {
    const reason = result.unavailableReason?.trim();
    return reason || FAIR_VALUE_UNAVAILABLE_CONFIDENCE;
  }
  if (result.confidence === "HIGH") {
    return "At least three methods are available, with sufficient supporting peer/history evidence.";
  }
  if (result.confidence === "MEDIUM") {
    return "More than one method is available, so the estimate is supported by a range of valuation methods.";
  }
  const freshness = result.assumptions.freshness;
  if (freshness !== "FRESH" && freshness !== "AGING") {
    return `Fundamentals are ${formatFreshnessBand(freshness)}, so confidence stays low.`;
  }
  return "Only one valuation method is available, so there is no valuation range.";
}

export function formatFairValueMultiple(method: FairValueMethodEvidence): string {
  if (!isFiniteNumber(method.medianMultiple)) return "Unavailable";
  if (method.currentInputName === "dividend_per_share" || method.id.includes("yield")) {
    return `${(method.medianMultiple * 100).toFixed(2)}%`;
  }
  return `${method.medianMultiple.toFixed(2)}x`;
}

export function fairValueInputLabel(method: FairValueMethodEvidence): string {
  if (method.currentInputName === "eps") return "EPS";
  if (method.currentInputName === "book_value_per_share") return "Book value per share";
  if (method.currentInputName === "dividend_per_share") return "Dividend per share";
  return "Input";
}

export function formatFairValueInputValue(method: FairValueMethodEvidence): string {
  if (!isFiniteNumber(method.currentInput)) return "Unavailable";
  if (method.currentInputName === "eps" || method.currentInputName === "dividend_per_share") {
    return method.currentInput.toFixed(4);
  }
  return formatMyr(method.currentInput);
}

export function formatFairValueInput(method: FairValueMethodEvidence): string {
  return `${fairValueInputLabel(method)}: ${formatFairValueInputValue(method)}`;
}

export function fairValueMethodSummary(method: FairValueMethodEvidence): string {
  if (!method.available || !isFiniteNumber(method.methodValue)) {
    return `${method.label} — ${method.unavailableReason?.trim() || "Unavailable"}`;
  }
  return `${method.label} → ${formatMyr(method.methodValue)}`;
}

export function fairValueSampleText(method: FairValueMethodEvidence): string {
  if (method.kind === "peer") {
    const count = method.peerCount ?? method.sampleSize;
    const group = method.peerGroup?.trim() || "Unavailable";
    return count == null ? `Peer group: ${group}` : `${count} peers · ${group}`;
  }
  const count = method.historicalSampleCount ?? method.sampleSize;
  const ends = method.historicalPeriodEnds?.filter((period) => period.trim()).join(", ");
  const countText = count == null ? "Sample unavailable" : `${count} observations`;
  return ends ? `${countText} · ${ends}` : countText;
}

export function fairValuePresentationHasRecommendationLanguage(text: string): boolean {
  return RECOMMENDATION_LANGUAGE.test(text);
}
