import { fairRangeSummary, type ListFairRange } from "@/lib/fair-range-summary";
import type { FairRangePosition } from "@/lib/fair-range";

export function fairRangeColor(position: FairRangePosition | null) {
  return position === "below"
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : position === "inside"
      ? "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
      : position === "above"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "bg-muted text-muted-foreground";
}

export function FairRangePill({ range }: { range?: ListFairRange }) {
  const { label, text, detail, position } = fairRangeSummary(range);
  return <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span className={`inline-block max-w-full rounded-full px-2 py-1 font-medium ${fairRangeColor(position)}`} title={position && range?.available ? range.positionText ?? label : undefined}>{label}</span>
    {text && <span className="text-muted-foreground tabular-nums">{detail ? `${detail} · ` : ""}{text}</span>}
  </div>;
}
