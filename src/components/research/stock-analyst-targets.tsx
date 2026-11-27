import { Suspense } from "react";
import { getAnalystTargetStore, TARGET_STORE_UNAVAILABLE, TARGET_STORE_UNCONFIGURED } from "@/analyst-targets/store";
import { targetAge, targetKey, type AnalystTarget } from "@/analyst-targets/target";
import { formatDateSafe } from "@/lib/display";
import { formatSharePrice } from "@/lib/format-myr";
import { AnalystTargetEditor } from "./analyst-target-editor";

function TargetList({ targets }: { targets: AnalystTarget[] }) {
  return (
    <ul className="space-y-1.5">
      {targets.map((target) => (
        <li key={targetKey(target)} className="min-w-0 rounded-md border px-2.5 py-1.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="min-w-0 wrap-anywhere font-medium">{target.broker}</span>
            <span className="whitespace-nowrap font-semibold tabular-nums">{formatSharePrice(target.target)}</span>
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <time dateTime={target.date}>{formatDateSafe(target.date)} · {targetAge(target.date)}</time>
            <a className="text-primary underline underline-offset-2" href={target.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${target.broker}, ${formatDateSafe(target.date)}`}>Source ↗</a>
          </div>
        </li>
      ))}
    </ul>
  );
}

async function AnalystTargets({ ticker }: { ticker: string }) {
  const store = getAnalystTargetStore();
  if (!store) return <p className="text-xs text-muted-foreground">{TARGET_STORE_UNCONFIGURED}</p>;

  let targets;
  try {
    targets = (await store.list(ticker)).sort((a, b) => b.date.localeCompare(a.date) || a.broker.localeCompare(b.broker));
  } catch {
    return <p className="text-xs text-muted-foreground">{TARGET_STORE_UNAVAILABLE}</p>;
  }
  return (
    <>
      {targets.length ? <TargetList targets={targets.slice(0, 3)} /> : <p className="text-xs text-muted-foreground">No analyst targets recorded for this stock.</p>}
      {targets.length > 3 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-primary">Show {targets.length - 3} more reports</summary>
          <div className="mt-1.5"><TargetList targets={targets.slice(3)} /></div>
        </details>
      ) : null}
      <AnalystTargetEditor ticker={ticker} />
    </>
  );
}

export function StockAnalystTargets({ ticker }: { ticker: string }) {
  return (
    <section className="mt-3 space-y-1.5 border-t pt-2.5" aria-label="Analyst targets">
      <h3 className="text-sm font-semibold">Analyst 12-month targets</h3>
      <p className="text-xs text-muted-foreground">Broker estimates, separate from the Genesis fair range. Not guaranteed prices.</p>
      <Suspense fallback={<p className="text-xs text-muted-foreground">Loading analyst targets…</p>}>
        <AnalystTargets ticker={ticker} />
      </Suspense>
    </section>
  );
}
