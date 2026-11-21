import type { SnapshotDates } from "@/lib/snapshot-dates";

export function DataLagBanner({ dates }: { dates: SnapshotDates }) {
  return (
    <details className="rounded-xl border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        Accounts:{" "}
        <span className="font-medium">{dates.fundamentals_period ?? "Unavailable"}</span>
        {" · Prices: "}
        <span className="font-medium">{dates.last_trade_date ?? "Unavailable"}</span>
        <span className="ml-3 text-xs text-primary underline">Date details</span>
      </summary>
      <p className="mt-3 leading-relaxed text-muted-foreground">Research run: {dates.score_as_of.slice(0, 10)}. {dates.lag_note}</p>
    </details>
  );
}
