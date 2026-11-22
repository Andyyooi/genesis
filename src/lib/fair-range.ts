import { isFiniteNumber } from "@/lib/display";
import type { FairValueRunRead } from "@/fair-value/load-run";

export type FairRangePosition = "below" | "inside" | "above";

export type FairRangeHeadline =
  | {
      available: true;
      low: number;
      high: number;
      middle: number;
      price: number | null;
      position: FairRangePosition | null;
      methodCount: number;
      /** Methods disagree a lot: the highest is more than double the lowest. */
      wideSpread: boolean;
      caution: boolean;
    }
  | { available: false; reason: string };

/** Linear-interpolated quantile of an ascending sample. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

/**
 * Headline fair range from a stored fair-value run: the middle half of the
 * method values (all of them when only two), so one outlying method does not
 * stretch the range. Uses only stored method values; no new valuation.
 */
export function fairRangeHeadline(
  stored: FairValueRunRead | null,
  currentPrice: number | null,
): FairRangeHeadline {
  if (!stored?.ok) return { available: false, reason: "No fair value has been worked out for this stock yet." };
  const { result, quality } = stored.run;
  if (quality.baseUse === "POINT_WITHHELD" || quality.baseUse === "NO_POINT") {
    return { available: false, reason: "The valuation checks did not pass, so no fair range is shown." };
  }
  const values = result.methods
    .filter((method) => method.available && isFiniteNumber(method.methodValue) && method.methodValue > 0)
    .map((method) => method.methodValue as number)
    .sort((a, b) => a - b);
  if (values.length < 2) {
    return { available: false, reason: "Only one valuation method worked for this stock, so there is no range." };
  }
  const low = quantile(values, 0.25);
  const high = quantile(values, 0.75);
  const middle = isFiniteNumber(result.fairValueBase) ? result.fairValueBase : quantile(values, 0.5);
  const price = isFiniteNumber(currentPrice) && currentPrice > 0 ? currentPrice : result.currentPrice;
  const position: FairRangePosition | null = !isFiniteNumber(price)
    ? null
    : price < low
      ? "below"
      : price > high
        ? "above"
        : "inside";
  return {
    available: true,
    low,
    high,
    middle,
    price: isFiniteNumber(price) ? price : null,
    position,
    methodCount: values.length,
    wideSpread: values[values.length - 1] > values[0] * 2,
    caution: quality.baseUse === "POINT_WITH_CAUTION",
  };
}

export const FAIR_RANGE_POSITION_TEXT: Record<FairRangePosition, string> = {
  below: "The price is below the fair range: cheaper than similar companies and its own past suggest.",
  inside: "The price is inside the fair range: not an unusually cheap or expensive price.",
  above: "The price is above the fair range: dearer than similar companies and its own past suggest.",
};
