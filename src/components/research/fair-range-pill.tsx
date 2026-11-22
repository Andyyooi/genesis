import { FAIR_RANGE_POSITION_TEXT, type FairRangeHeadline } from "@/lib/fair-range";
import { fairRangeSummary } from "@/lib/fair-range-summary";

export function FairRangePill({ range }: { range?: FairRangeHeadline }) {
  const { label, text, position } = fairRangeSummary(range);
  const color = position === "below"
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : position === "above"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-muted text-muted-foreground";
  return <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span className={`inline-block max-w-full rounded-full px-2 py-1 font-medium ${color}`} title={position ? FAIR_RANGE_POSITION_TEXT[position] : undefined}>{label}</span>
    {text && <span className="text-muted-foreground tabular-nums">{text}</span>}
  </div>;
}
