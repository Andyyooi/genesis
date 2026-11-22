"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHeldTickers } from "@/components/holdings-store";
import type { HoldingSignal } from "@/lib/holding-signals";

type Quote = { ticker: string; signals: HoldingSignal[]; warnings: string[] };

export function HoldingsAlerts() {
  const held = useHeldTickers();
  const tickers = [...held].sort().join(",");
  const [result, setResult] = useState<{ tickers: string; quotes: Quote[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!tickers) return;
    const controller = new AbortController();
    fetch(`/api/holdings?tickers=${encodeURIComponent(tickers)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not check your holdings.");
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ tickers, quotes: data.quotes });
      })
      .catch(error => { if (error.name !== "AbortError") setFailed(tickers); });
    return () => controller.abort();
  }, [tickers]);
  const quotes = result?.tickers === tickers ? result.quotes : null;
  const matches = quotes?.filter(quote => quote.signals.length) ?? [];
  return <section className="market-card p-5" aria-labelledby="holdings-alerts-title">
    <h2 id="holdings-alerts-title" className="text-xl font-semibold">My holdings alerts</h2>
    <p className="mt-2 text-sm text-muted-foreground">Below-fair-range and price-down flags for holdings saved in this browser. These are current saved conditions, not new price crossings or phone notifications.</p>
    {!tickers ? <p className="mt-4 text-sm">No holdings are saved here. <Link href="/holdings" className="text-primary underline">Add your holdings</Link> to see their alerts.</p>
      : failed === tickers && !quotes ? <p role="alert" className="mt-4 text-sm">Could not check your holdings. Reload this page to try again.</p>
      : !quotes ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking your holdings…</p>
      : <>
        {!matches.length && <p className="mt-4 text-sm">No below-fair-range or price-down flags found in the available data for your {quotes.length} holding{quotes.length === 1 ? "" : "s"}.</p>}
        <ul className="mt-4 space-y-4">
          {matches.map(quote => <li key={quote.ticker} className="rounded-lg border border-l-4 border-l-primary p-4">
            <Link href={`/stock/${encodeURIComponent(quote.ticker)}`} className="font-semibold text-primary underline">{quote.ticker}</Link>
            {quote.signals.map(signal => <div key={signal.kind} className="mt-3">
              <h3 className="font-medium">{signal.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{signal.why}</p>
              <p className="mt-1 text-xs text-muted-foreground">Saved price date: {signal.date ?? "unavailable"}</p>
            </div>)}
            {quote.warnings.length > 0 && <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer">Data notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{quote.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
          </li>)}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{quotes.length} holding{quotes.length === 1 ? "" : "s"} checked. Missing prices, ranges or account checks cannot produce a flag. Open a stock to check dates and coverage.</p>
      </>}
  </section>;
}
