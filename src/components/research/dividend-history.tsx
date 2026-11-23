"use client";

import { useEffect, useState } from "react";
import type { DividendHistory as History, DividendYear } from "@/providers/yahoo-dividends";

function cashFormat(currency: string) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 5,
  });
}

export function dividendTrackRecord(history: History): string {
  const fullYears = history.years.filter(year => !year.toDate);
  const reported = fullYears.filter((year): year is DividendYear & { perShare: number } => year.perShare !== null);
  const [latest, prior] = reported;
  if (!latest) return "No payments reported for the full years checked; the record may be incomplete.";
  const format = cashFormat(history.currency);
  const change = prior && prior.year === latest.year - 1 ? ` vs ${format.format(prior.perShare)} in ${prior.year}` : "";
  return `Payments reported in ${reported.length} of the last ${fullYears.length} full years. ${latest.year}: ${format.format(latest.perShare)}/share${change}.`;
}

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
  return <div>
    {!current ? <p className="text-muted-foreground" role="status">Loading dividend track record…</p>
      : current.error ? <div><p role="status" className="text-muted-foreground"><strong>Dividend track record:</strong> {current.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-1 underline underline-offset-4">Try again</button></div>
      : history ? <>
        <p><strong>Dividend track record:</strong> {dividendTrackRecord(history)}</p>
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">Five-year dividend history</summary>
          <p className="mt-2 text-xs text-muted-foreground">Grouped by the year of the ex-dividend date.</p>
          <ul className="mt-1 divide-y">
            {history.years.map(row => <li key={row.year} className="flex flex-wrap items-baseline justify-between gap-x-2 py-2">
              <span className="font-medium">{row.year}{row.toDate ? " so far" : ""}</span>
              <span className="tabular-nums">{row.perShare === null ? "Not reported" : `${cashFormat(history.currency).format(row.perShare)}/share · ${row.payments} payment${row.payments === 1 ? "" : "s"}`}</span>
            </li>)}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Yahoo Finance · Checked {history.checkedAt.slice(0, 10)}. No payments reported is not proof that no dividend was paid. Amounts may reflect share splits; check company announcements. Past dividends do not guarantee future income.</p>
        </details>
      </> : null}
  </div>;
}
