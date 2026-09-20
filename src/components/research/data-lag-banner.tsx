import type { SnapshotDates } from "@/lib/snapshot-dates";

export function DataLagBanner({ dates }: { dates: SnapshotDates }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <p className="font-medium">Filing year vs live date</p>
      <p>
        Fundamentals period:{" "}
        <span className="font-medium">{dates.fundamentals_period ?? "Data unavailable"}</span>
        {" · "}
        Price as-of / last trade:{" "}
        <span className="font-medium">{dates.last_trade_date ?? "Data unavailable"}</span>
        {" · "}
        Score run: {dates.score_as_of.slice(0, 10)}
      </p>
      <p className="mt-1 text-muted-foreground">{dates.lag_note}</p>
    </div>
  );
}
