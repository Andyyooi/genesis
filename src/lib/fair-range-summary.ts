import { type FairRangeHeadline } from "@/lib/fair-range";
import { formatSharePrice } from "@/lib/format-myr";

export function fairRangeSummary(range: FairRangeHeadline | undefined) {
  if (!range?.available) return { label: "No fair range", text: null, position: null };
  const estimate = (value: number) => formatSharePrice(Math.max(0.005, Math.round(value * 200) / 200));
  return {
    label: range.position === "below" ? "Below fair range" : range.position === "inside" ? "Inside fair range" : range.position === "above" ? "Above fair range" : "Price unavailable",
    text: `Fair ${estimate(range.low)}–${estimate(range.high)}`,
    position: range.position,
  };
}
