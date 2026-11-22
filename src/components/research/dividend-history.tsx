"use client";

import { useEffect, useState } from "react";
import type { DividendHistory as History } from "@/providers/yahoo-dividends";

export function DividendHistory({ ticker }: { ticker: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ ticker: string; attempt: number; history?: History; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dividends?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Dividend history could not be loaded.");
        if (!controller.signal.aborted) setResult({ ticker, attempt, history: body });
      })
      .catch(error => {
        if (error.name !== "AbortError") setResult({ ticker, attempt, error: error.message });
      });
    return () => controller.abort();
  }, [ticker, attempt]);
  const current = result?.ticker === ticker && result.attempt === attempt ? result : null;
  const history = current?.history;
  return <section className="market-card p-5" aria-labelledby="dividend-history-title">
    <h2 id="dividend-history-title" className="text-xl font-semibold">Five-year dividend history</h2>
    <p className="mt-2 text-sm text-muted-foreground">Cash dividends per share, grouped by the year of the ex-dividend date. The newest year is only the year so far.</p>
    {!current ? <p className="mt-4 text-sm text-muted-foreground" role="status">Loading dividend history…</p>
      : current.error ? <div className="mt-4"><p role="status" className="text-sm text-muted-foreground">{current.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted">Try again</button></div>
      : history ? <>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Five-year cash dividend totals for {ticker}, per share in {history.currency}</caption>
            <thead><tr className="border-b"><th scope="col" className="py-3 pr-4 font-medium text-muted-foreground">Year</th><th scope="col" className="px-2 py-3 font-medium text-muted-foreground">Cash per share ({history.currency})</th><th scope="col" className="py-3 pl-2 text-right font-medium text-muted-foreground">Payments reported</th></tr></thead>
            <tbody>{history.years.map(row => <tr key={row.year} className="border-b last:border-0">
              <th scope="row" className="py-3 pr-4 font-medium">{row.year}{row.toDate ? <span className="mt-1 block text-xs font-normal text-muted-foreground">Year to date</span> : null}</th>
              <td className="px-2 py-3 tabular-nums">{row.perShare === null ? <span className="text-muted-foreground">Not reported</span> : new Intl.NumberFormat("en-MY", { style: "currency", currency: history.currency, minimumFractionDigits: 3, maximumFractionDigits: 5 }).format(row.perShare)}</td>
              <td className="py-3 pl-2 text-right tabular-nums">{row.payments || "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Yahoo Finance · Checked {history.checkedAt.slice(0, 10)} · Loaded separately from saved research. No payments reported is not proof that no dividend was paid. Provider amounts may reflect share splits; check company announcements. Past dividends do not guarantee future income.</p>
      </> : null}
  </section>;
}
