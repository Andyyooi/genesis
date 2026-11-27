import { isSnapshotReadOnly } from "@/lib/data-mode";
import type { DataHealth } from "@/refresh/data-health";

export function SnapshotBanner({ health }: { health: DataHealth | null }) {
  return (
    <>
      {!health || health.status === "degraded" ? (
        <div role="status" className="border-b border-amber-400/40 bg-amber-950/40 px-4 py-3 text-center text-sm text-amber-200">
          <p className="font-semibold">
            {!health ? "Saved price data is unavailable"
              : !health.asOfDate ? "No saved closing prices"
              : health.stale && health.lowCoverage ? "Prices are out of date and coverage is low"
              : health.stale ? "Prices are out of date" : "Price coverage is low"}
          </p>
          {health?.stale && health.asOfDate ? <p>Latest saved close: {health.asOfDate}.</p> : null}
          {health?.lowCoverage && health.asOfDate ? (
            <p>{health.freshPriceCount.toLocaleString("en-MY")} of {health.listedCount.toLocaleString("en-MY")} listed names have prices for both latest saved sessions.</p>
          ) : null}
        </div>
      ) : null}
      {isSnapshotReadOnly() ? (
        <details className="border-b bg-secondary/50 px-4 py-2 text-center text-xs text-muted-foreground">
          <summary className="cursor-pointer">Published data · not live <span className="ml-2 underline">How updates work</span></summary>
          <p className="mx-auto mt-2 max-w-2xl leading-relaxed">Refresh data requests a new publication. Updated prices and accounts appear after publishing finishes; the website does not download live prices.</p>
        </details>
      ) : null}
    </>
  );
}
