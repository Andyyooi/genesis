import { type FairRangeHeadline, type FairRangePosition } from "@/lib/fair-range";
import { formatSharePrice } from "@/lib/format-myr";

export type ListFairRange = (Pick<Extract<FairRangeHeadline, { available: true }>, "available" | "position" | "low" | "high"> & { positionText?: string | null; price?: number | null }) | { available: false };

/**
 * How far today's price is from the fair range: percent under the low end
 * (below), over the high end (above), or how far up the range it sits
 * (inside, 0 = low end, 100 = high end).
 */
export function fairRangeGap(range: ListFairRange | undefined): { position: FairRangePosition; percent: number } | null {
  if (!range?.available || !range.position) return null;
  const price = range.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  const { low, high } = range;
  if (range.position === "below") return { position: "below", percent: Math.max(0, ((low - price) / low) * 100) };
  if (range.position === "above") return { position: "above", percent: Math.max(0, ((price - high) / high) * 100) };
  return { position: "inside", percent: high > low ? Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100)) : 50 };
}

function gapLabel(gap: NonNullable<ReturnType<typeof fairRangeGap>>): { label: string; detail: string | null } {
  if (gap.position === "inside") {
    const where = gap.percent < 100 / 3 ? "near the low end" : gap.percent > 200 / 3 ? "near the high end" : "around the middle";
    return { label: "Inside fair range", detail: where };
  }
  const rounded = Math.round(gap.percent);
  return { label: rounded < 1 ? `Just ${gap.position} fair range` : `${rounded}% ${gap.position} fair range`, detail: null };
}

export function fairRangeSummary(range: ListFairRange | undefined) {
  if (!range?.available) return { label: "No fair range", text: null, detail: null, position: null };
  const estimate = (value: number) => formatSharePrice(Math.max(0.005, Math.round(value * 200) / 200));
  const gap = fairRangeGap(range);
  const plain = range.position === "below" ? "Below fair range" : range.position === "inside" ? "Inside fair range" : range.position === "above" ? "Above fair range" : "Price unavailable";
  const { label, detail } = gap ? gapLabel(gap) : { label: plain, detail: null };
  return {
    label,
    text: `Fair ${estimate(range.low)}–${estimate(range.high)}`,
    detail,
    position: range.position,
  };
}
