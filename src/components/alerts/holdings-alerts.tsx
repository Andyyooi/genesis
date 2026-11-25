"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHeldTickers, useStarredTickers } from "@/components/holdings-store";
import type { HoldingSignal } from "@/lib/holding-signals";

type Quote = { ticker: string; signals: HoldingSignal[]; warnings: string[] };

const signalDateLabel: Record<HoldingSignal["kind"], string> = {
  "new-results": "Results date",
  "below-fair-range": "Saved price date",
  "price-down": "Saved price date",
};

const signalTone: Record<HoldingSignal["kind"], string> = {
  "new-results": "border-l-emerald-600",
  "below-fair-range": "border-l-primary",
  "price-down": "border-l-amber-500",
};

export function HoldingsAlerts() {
  const held = useHeldTickers();
  const starred = useStarredTickers();
  const tracked = [...new Set([...held, ...starred])].sort();
  const tickers = tracked.join(",");
  const [result, setResult] = useState<{ tickers: string; quotes: Quote[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!tickers) return;
    const controller = new AbortController();
    fetch(`/api/holdings?tickers=${encodeURIComponent(tickers)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not check your holdings and starred stocks.");
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ tickers, quotes: data.quotes });
      })
      .catch(error => { if (error.name !== "AbortError") setFailed(tickers); });
    return () => controller.abort();
  }, [tickers]);
  const quotes = result?.tickers === tickers ? result.quotes : null;
  const matches = quotes?.filter(quote => quote.signals.length) ?? [];
  return <section className="market-card p-5" aria-labelledby="holdings-alerts-title">
    <h2 id="holdings-alerts-title" className="text-xl font-semibold">My holdings &amp; starred alerts</h2>
    <p className="mt-2 text-sm text-muted-foreground">New quarterly results (profit and debt vs last year), below-fair-range, and price-down flags for stocks you hold or starred in this browser.</p>
    {!tickers ? <p className="mt-4 text-sm">No holdings or starred stocks are saved here. <Link href="/holdings" className="text-primary underline">Add your holdings</Link> or star stocks from the dashboard to see their alerts.</p>
      : failed === tickers && !quotes ? <p role="alert" className="mt-4 text-sm">Could not check your holdings and starred stocks. Reload this page to try again.</p>
      : !quotes ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking your holdings and starred stocks…</p>
      : <>
        {!matches.length && <p className="mt-4 text-sm">No new quarterly results, below-fair-range or price-down flags found in the available data for your {quotes.length} tracked stock{quotes.length === 1 ? "" : "s"}.</p>}
        <ul className="mt-4 space-y-4">
          {matches.map(quote => {
            const isHeld = held.has(quote.ticker);
            const isStarred = starred.has(quote.ticker);
            const tag = isHeld && isStarred ? "Held · Starred" : isHeld ? "Held" : "Starred";
            const borderTone = signalTone[quote.signals[0]!.kind];
            return <li key={quote.ticker} className={`rounded-lg border border-l-4 ${borderTone} p-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/stock/${encodeURIComponent(quote.ticker)}`} className="font-semibold text-primary underline">{quote.ticker}</Link>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
              </div>
              {quote.signals.map(signal => <div key={signal.kind} className="mt-3">
                <h3 className="font-medium">{signal.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{signal.why}</p>
                <p className="mt-1 text-xs text-muted-foreground">{signalDateLabel[signal.kind]}: {signal.date ?? "unavailable"}</p>
              </div>)}
              {quote.warnings.length > 0 && <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer">Data notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{quote.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
            </li>;
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{quotes.length} held or starred stock{quotes.length === 1 ? "" : "s"} checked. Missing prices, ranges or quarterly accounts cannot produce a flag. Open a stock to check dates and coverage.</p>
      </>}
  </section>;
}
