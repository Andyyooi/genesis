import Link from "next/link";
import { formatSharePrice } from "@/lib/format-myr";
import { loadWatchCloses, loadWatchInstrument, loadWatchRange } from "@/price-watches/snapshot";
import { getPriceWatchStore, WATCH_STORE_UNAVAILABLE, WATCH_STORE_UNCONFIGURED } from "@/price-watches/store";
import { evaluatePriceWatch, type PriceWatch } from "@/price-watches/watch";
import { StatusLabel } from "@/components/research/status-label";

function watchRow(watch: PriceWatch) {
  const instrument = loadWatchInstrument(watch.ticker);
  const [latest, previous] = instrument ? loadWatchCloses(instrument.id) : [];
  const range = instrument && watch.kind === "fair-range" ? loadWatchRange(instrument.id) : undefined;
  return { watch, latest, range, result: evaluatePriceWatch(watch, latest, previous, range) };
}

function WatchCards({ rows }: { rows: ReturnType<typeof watchRow>[] }) {
  return (
    <ul className="grid gap-2">
      {rows.map(({ watch, latest, range, result }) => {
        const target = watch.kind === "target";
        const goal = target ? `Target: ${formatSharePrice(watch.target)} or less`
          : range ? `Genesis fair range: ${formatSharePrice(range.low)}–${formatSharePrice(range.high)}`
            : "Genesis fair range";
        const difference = result.status === "triggered" ? (target ? "Target reached" : "Entered the fair range")
          : result.status === "no-close" ? "No saved closing price"
            : result.status === "no-range" ? "Fair range not available"
              : result.status === "inside" ? "Inside the range (0% away); no new entry"
                : `${result.percent < 0.1 ? "Less than 0.1" : result.percent.toFixed(1)}% ${result.direction} the ${target ? "target" : "range"}`;
        return (
          <li key={watch.ticker} className="market-card min-w-0 space-y-1 break-words p-3 text-sm">
            <Link className="font-semibold underline underline-offset-4" href={`/stock/${encodeURIComponent(watch.ticker)}`}>{watch.ticker}</Link>
            <p>{goal}</p>
            {latest && <p className="text-muted-foreground">Saved close: {formatSharePrice(latest.close)} · {latest.date}</p>}
            <StatusLabel level={result.status === "triggered" ? "HIGH" : "UNKNOWN"}>{difference}</StatusLabel>
          </li>
        );
      })}
    </ul>
  );
}

export async function PriceWatchAlerts() {
  const store = getPriceWatchStore();
  let rows: ReturnType<typeof watchRow>[] = [];
  let error = store ? null : WATCH_STORE_UNCONFIGURED;
  try {
    if (store) rows = (await store.list()).sort((a, b) => a.ticker.localeCompare(b.ticker)).map(watchRow);
  } catch {
    error = WATCH_STORE_UNAVAILABLE;
  }
  const triggered = rows.filter(({ result }) => result.status === "triggered");
  const waiting = rows.filter(({ result }) => result.status !== "triggered");

  return (
    <section className="space-y-3" aria-labelledby="price-watches-heading">
      <h2 id="price-watches-heading" className="text-xl font-semibold">Price watches</h2>
      <p className="text-sm text-muted-foreground">Checked against saved closing prices after each refresh, not live quotes. Add or change a watch on its stock page.</p>
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : (
        <>
          <h3 className="font-semibold">Triggered watches</h3>
          {triggered.length ? <WatchCards rows={triggered} /> : <p className="text-sm text-muted-foreground">No price watches triggered.</p>}
          <h3 className="font-semibold">Active watches</h3>
          {waiting.length ? <WatchCards rows={waiting} /> : <p className="text-sm text-muted-foreground">No price watches waiting for a trigger.</p>}
        </>
      )}
    </section>
  );
}
