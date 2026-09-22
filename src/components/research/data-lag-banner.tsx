import type { SnapshotDates } from "@/lib/snapshot-dates";

export function DataLagBanner({ dates }: { dates: SnapshotDates }) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <p className="font-medium">Data snapshot dates</p>
      <p>
        Fundamentals period:{" "}
        <span className="font-medium">{dates.fundamentals_period ?? "Unavailable"}</span>
        {" · "}
        Price date:{" "}
        <span className="font-medium">{dates.last_trade_date ?? "Unavailable"}</span>
        {" · "}
        Research run: {dates.score_as_of.slice(0, 10)}
      </p>
      <p className="mt-1 text-muted-foreground">{dates.lag_note}</p>
    </div>
  );
}
