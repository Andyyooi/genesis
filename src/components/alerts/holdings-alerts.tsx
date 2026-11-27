"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { refreshPortfolio, usePortfolio } from "@/components/holdings-store";
import { isOwnedStockSignal, type HoldingSignal } from "@/lib/holding-signals";

type Quote = { ticker: string; signals: HoldingSignal[]; warnings: string[] };

const signalDateLabel: Record<HoldingSignal["kind"], string> = {
  "new-results": "Results date",
  "below-fair-range": "Saved price date",
  "price-down": "Saved price date",
  "score-changed": "Refresh date",
  "range-moved": "Refresh date",
  "watch-triggered": "Saved price date",
};

const signalTone: Record<HoldingSignal["kind"], string> = {
  "new-results": "border-l-emerald-600",
  "below-fair-range": "border-l-primary",
  "price-down": "border-l-amber-500",
  "score-changed": "border-l-primary",
  "range-moved": "border-l-primary",
  "watch-triggered": "border-l-amber-500",
};

export function HoldingsAlerts() {
  const saved = usePortfolio();
  const held = new Set(saved.portfolio.holdings.map(h => h.ticker));
  const starred = new Set(saved.portfolio.starred);
  const tracked = [...new Set([...held, ...starred])].sort();
  const tickers = tracked.map(encodeURIComponent).join(",");
  const [result, setResult] = useState<{ tickers: string; quotes: Quote[]; watchesUnavailable: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!tickers) return;
    const controller = new AbortController();
    fetch(`/api/holdings?tickers=${tickers}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not check your holdings and starred stocks.");
        const data = await response.json();
        if (!controller.signal.aborted) setResult({ tickers, quotes: data.quotes, watchesUnavailable: data.watchesUnavailable });
      })
      .catch(error => { if (error.name !== "AbortError") setFailed(tickers); });
    return () => controller.abort();
  }, [tickers]);
  const quotes = result?.tickers === tickers ? result.quotes : null;
  const matches = quotes?.map(quote => ({ ...quote, signals: quote.signals.filter(signal => held.has(quote.ticker) || !isOwnedStockSignal(signal.kind)) }))
    .filter(quote => quote.signals.length) ?? [];
  return <section className="market-card p-5" aria-labelledby="holdings-alerts-title">
    <h2 id="holdings-alerts-title" className="text-xl font-semibold">My holdings &amp; starred alerts</h2>
    <p className="mt-2 text-sm text-muted-foreground">Results, below-fair-range and price-down flags for held and starred stocks. For stocks you own, see research score and fair range changes since the previous refresh, plus triggered watches.</p>
    {saved.mode === "loading" ? <p role="status" className="mt-4 text-sm">Loading your saved stocks…</p>
      : saved.mode === "error" ? <p role="alert" className="mt-4 text-sm">{saved.error} <button type="button" className="underline" onClick={() => void refreshPortfolio()}>Retry</button></p>
      : !tickers ? <p className="mt-4 text-sm">No holdings or starred stocks are saved here. <Link href="/holdings" className="text-primary underline">Add your holdings</Link> or star stocks from the dashboard to see their alerts.</p>
      : failed === tickers && !quotes ? <p role="alert" className="mt-4 text-sm">Could not check your holdings and starred stocks. Reload this page to try again.</p>
      : !quotes ? <p role="status" className="mt-4 text-sm text-muted-foreground">Checking your holdings and starred stocks…</p>
      : <>
        {result?.watchesUnavailable && held.size > 0 && <p role="status" className="mt-4 text-sm">Price watches couldn’t be checked right now.</p>}
        {!matches.length && <p className="mt-4 text-sm">No flags found in the available data for your {quotes.length} tracked stock{quotes.length === 1 ? "" : "s"}.</p>}
        <ul className="mt-4 space-y-4">
          {matches.map(quote => {
            const isHeld = held.has(quote.ticker);
            const isStarred = starred.has(quote.ticker);
            const tag = isHeld && isStarred ? "Held · Starred" : isHeld ? "Held" : "Starred";
            const borderTone = signalTone[quote.signals[0]!.kind];
            return <li key={quote.ticker} className={`rounded-lg border border-l-4 ${borderTone} p-4 [overflow-wrap:anywhere]`}>
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
        <p className="mt-3 text-xs text-muted-foreground">{quotes.length} held or starred stock{quotes.length === 1 ? "" : "s"} checked. Missing data can prevent a flag. Open a stock to check dates and coverage.</p>
      </>}
  </section>;
}
