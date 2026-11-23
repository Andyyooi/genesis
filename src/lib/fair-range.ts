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
      positionText: string | null;
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
 * stretch the range. Methods the quality checks flagged are left out. Uses
 * only stored method values; no new valuation.
 */
export function fairRangeHeadline(
  stored: FairValueRunRead | null,
  currentPrice: number | null,
): FairRangeHeadline {
  if (!stored?.ok) return { available: false, reason: "No fair value has been worked out for this stock yet." };
  const { result, quality } = stored.run;
  if (quality.baseUse === "NO_POINT") {
    const reason = result.researchProfile === "OTHER_FINANCIAL" || result.researchProfile === "UNKNOWN"
      ? result.unavailableReason : null;
    return { available: false, reason: reason ?? "The available figures did not support a valuation." };
  }
  if (quality.baseUse === "POINT_WITHHELD") {
    return { available: false, reason: "The valuation checks did not pass, so no fair range is shown." };
  }
  const flagged = new Set(quality.methods.filter((method) => method.state === "FLAGGED").map((method) => method.id));
  const methods = result.methods
    .filter((method) => !flagged.has(method.id))
    .filter((method) => method.available && isFiniteNumber(method.methodValue) && method.methodValue > 0);
  const values = methods
    .map((method) => method.methodValue as number)
    .sort((a, b) => a - b);
  if (values.length < 2) {
    return { available: false, reason: result.unavailableReason ?? "Fewer than two valuation methods passed the checks, so there is no range." };
  }
  const low = values.length === 2 ? values[0] : quantile(values, 0.25);
  const high = values.length === 2 ? values[1] : quantile(values, 0.75);
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
    positionText: position ? fairRangePositionText(position, methods.some(({ kind }) => kind === "peer"), methods.some(({ kind }) => kind === "history")) : null,
    methodCount: values.length,
    wideSpread: values[values.length - 1] > values[0] * 2,
    caution: quality.baseUse === "POINT_WITH_CAUTION",
  };
}

function fairRangePositionText(position: FairRangePosition, hasPeers: boolean, hasHistory: boolean): string {
  if (position === "inside") return "The price is inside the fair range: not an unusually cheap or expensive price.";
  const prefix = `The price is ${position} the fair range`;
  const comparison = hasPeers && hasHistory ? "similar companies and its own past suggest"
    : hasPeers ? "similar companies suggest"
      : hasHistory ? "its own trading history suggests" : null;
  return comparison ? `${prefix}: ${position === "below" ? "cheaper" : "dearer"} than ${comparison}.` : `${prefix}.`;
}
