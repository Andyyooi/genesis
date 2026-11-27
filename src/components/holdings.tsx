"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { backupJson, HOLDINGS_KEY, holdingValue, mergeHolding, parseBackup, totalYearlyDividends, validateHolding, yearlyHoldingDividends, type Holding } from "@/lib/holdings";
import type { DividendBasis } from "@/lib/dividend-yield";
import { formatMyr } from "@/lib/format-myr";
import { formatScore100 } from "@/lib/research-copy";
import { FairRangePill } from "@/components/research/fair-range-pill";
import type { ListFairRange } from "@/lib/fair-range-summary";

type Quote = { ticker: string; fairRange?: ListFairRange; price: number | null; priceDate: string | null; score: number | null; annualDividend: DividendBasis | null; warnings: string[] };
type Data = { universe: { ticker: string; name: string }[]; quotes: Quote[] };
const priceText = (n: number | null) => n === null ? "Unavailable" : `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 3, maximumFractionDigits: 5 })}`;
const button = "rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted";

export function Holdings() {
  const [rows, setRows] = useState<Holding[] | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [stock, setStock] = useState("");
  const [shares, setShares] = useState("");
  const [average, setAverage] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(HOLDINGS_KEY);
        setRows(raw ? parseBackup(raw) : []);
      } catch { setError("Could not read saved holdings. Restore a backup or enable browser storage. Existing data has not been overwritten."); }
    };
    const timer = window.setTimeout(read, 0);
    window.addEventListener("storage", read);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", read); };
  }, []);
  const tickers = rows?.map(h => h.ticker).join(",") ?? "";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/holdings?tickers=${encodeURIComponent(tickers)}`, { signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error("Could not load market data. Reload to try again.");
      return r.json();
    }).then(setData).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [tickers]);
  function save(next: Holding[]) {
    try {
      localStorage.setItem(HOLDINGS_KEY, backupJson(next));
      setRows(next);
      window.dispatchEvent(new Event("holdings-change"));
      setError("");
      return true;
    } catch { setError("Could not save. Browser storage may be disabled or full. Your previous holdings are unchanged."); return false; }
  }
  function reset() { setEditing(null); setStock(""); setShares(""); setAverage(""); }
  const holdings = (rows ?? []).map(h => {
    const quote = data?.quotes.find(q => q.ticker === h.ticker);
    return {
      h, quote,
      value: holdingValue(h, quote?.price ?? null),
      dividend: yearlyHoldingDividends(h.shares, quote?.annualDividend?.perShare ?? null),
    };
  });
  const totals = holdings.reduce((sum, { value: v }) => {
    return { cost: sum.cost + v.cost, value: sum.value + (v.value ?? 0), missing: sum.missing || v.value === null };
  }, { cost: 0, value: 0, missing: false });
  const dividends = totalYearlyDividends(holdings.map(h => h.dividend));
  const dividendsLoaded = holdings.every(h => h.quote);
  return <>
    <section className="market-card p-5 flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-2xl text-sm text-muted-foreground">Holdings stay in this browser, not on the server. Clearing browser data removes them. Download a backup to move devices or keep a safe copy.</p>
      <div className="flex gap-2"><button className={button} disabled={rows === null} onClick={() => {
        const url = URL.createObjectURL(new Blob([backupJson(rows ?? [])], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = "genesis-holdings.json"; a.click(); URL.revokeObjectURL(url);
      }}>Backup</button><label className={`${button} cursor-pointer`}>Restore<input className="sr-only" type="file" accept="application/json,.json" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        try {
          if (file.size > 1000000) throw new Error("Backup is too large (maximum 1 MB).");
          const restored = parseBackup(await file.text());
          if (!data) throw new Error("Wait for the stock list before restoring.");
          const unknown = restored.find(h => !data.universe.some(s => s.ticker === h.ticker));
          if (unknown) throw new Error(`Unknown ticker in backup: ${unknown.ticker}. Nothing was changed.`);
          if (window.confirm(`Replace this browser's holdings with ${restored.length} backed-up holdings?`)) {
            if (save(restored)) { reset(); setNotice("Backup restored."); }
          }
        } catch (e) { setError(e instanceof Error ? e.message : "Invalid backup"); }
      }} /></label></div>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-400 p-4 text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <form className="market-card grid min-w-0 grid-cols-1 items-end gap-4 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={e => {
      e.preventDefault();
      try {
        const match = data?.universe.find(s => s.ticker.toUpperCase() === stock.trim().toUpperCase() || s.name.toUpperCase() === stock.trim().toUpperCase());
        if (!match) throw new Error("Choose a ticker or exact company name from the stock list.");
        const h = validateHolding({ ticker: match.ticker, shares: Number(shares), averagePrice: Number(average) });
        if (editing && h.ticker !== editing && rows?.some(r => r.ticker === h.ticker)) throw new Error("You already own this ticker. Edit that holding instead.");
        const next = editing ? (rows ?? []).map(r => r.ticker === editing ? h : r) : mergeHolding(rows ?? [], h);
        if (save(next)) { reset(); setNotice(editing ? "Holding updated." : "Holding saved. Repeat tickers are merged using a weighted average."); }
      } catch (e) { setError(e instanceof Error ? e.message : "Invalid holding"); }
    }}>
      <label className="flex min-w-0 flex-col gap-2 text-sm">Stock ticker or name<input className="min-w-0 w-full rounded border bg-background p-2 text-base" list="stock-universe" required value={stock} onChange={e => setStock(e.target.value)} placeholder="e.g. MAYBANK" /></label>
      <datalist id="stock-universe">{data?.universe.map(s => <option key={s.ticker} value={s.ticker}>{s.name}</option>)}</datalist>
      <label className="flex min-w-0 flex-col gap-2 text-sm">Number of shares<input className="min-w-0 w-full rounded border bg-background p-2 text-base" type="number" step="any" min="0" required value={shares} onChange={e => setShares(e.target.value)} /></label>
      <label className="flex min-w-0 flex-col gap-2 text-sm">Average price paid (RM per share)<input className="min-w-0 w-full rounded border bg-background p-2 text-base" type="number" step="any" min="0" required value={average} onChange={e => setAverage(e.target.value)} placeholder="0.245" /></label>
      <button className={`${button} bg-primary text-primary-foreground`} disabled={!data || rows === null}>{editing ? "Save changes" : "Add holding"}</button>
      {editing && <button type="button" className={button} onClick={reset}>Cancel</button>}
    </form>
    {rows?.length === 0 ? <section className="market-card p-8"><h2 className="text-xl font-semibold">Start with a stock you own</h2><p className="mt-2 text-muted-foreground">Enter your shares and average price above. Your holdings stay in this browser. No account or server changes needed.</p></section> : rows === null ? <p>Waiting for browser storage. If it cannot be read, restore a backup above.</p> : <section aria-label="Your holdings" className="min-w-0 space-y-4">
      <div className="market-card border-emerald-300 p-5 [overflow-wrap:anywhere] dark:border-emerald-800">
        <h2 className="font-semibold">Estimated yearly dividends — total</h2>
        <p className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-300">{dividends.total === null
          ? dividendsLoaded ? "No dividend data" : "Dividend data not loaded"
          : formatMyr(dividends.total)}</p>
        {dividends.total !== null && dividends.missing > 0 && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          Partial total: {dividends.missing} {dividends.missing === 1 ? "holding" : "holdings"} not included.
        </p>}
        <details className="mt-3 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium">How this is estimated</summary>
          <p className="mt-2">We multiply your shares by cash dividends per share over the last 12 months by ex-dividend date, or the latest full financial year with reported dividends. We leave out stocks without usable data. Payments can change; this is not a promise of what you’ll receive.</p>
        </details>
      </div>
      <p className="text-sm text-muted-foreground">Stored prices, not live quotes. Gains exclude fees and dividends. Genesis scores are research scores out of 100, not buy signals.</p>
      <ul className="space-y-4">{holdings.map(({ h, quote: q, value: v, dividend }) => {
          const yieldPct = q?.annualDividend && q.price !== null && Number.isFinite(q.price) && q.price > 0
            ? 100 * q.annualDividend.perShare / q.price
            : null;
          return <li key={h.ticker} className="market-card min-w-0 p-5 text-sm [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1"><Link className="font-semibold underline" href={`/stock/${encodeURIComponent(h.ticker)}`}>{h.ticker}</Link><p className="mt-1 text-muted-foreground">{data?.universe.find(s => s.ticker === h.ticker)?.name}</p></div>
              <div className="flex flex-wrap gap-2"><button className={button} aria-label={`Edit ${h.ticker}`} onClick={() => { setEditing(h.ticker); setStock(h.ticker); setShares(String(h.shares)); setAverage(String(h.averagePrice)); }}>Edit</button><button className={button} aria-label={`Remove ${h.ticker}`} onClick={() => { if (window.confirm(`Remove ${h.ticker}?`)) { if (save(rows.filter(r => r.ticker !== h.ticker))) reset(); } }}>Remove</button></div>
            </div>
            {q ? <FairRangePill range={q.fairRange} /> : <p className="mt-2 text-xs text-muted-foreground">Loading fair range…</p>}
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 xl:grid-cols-8">
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Estimated yearly dividends</dt>
                <dd className="mt-1 font-medium">
                  {dividend !== null && q?.annualDividend ? <details>
                    <summary className="cursor-pointer text-emerald-700 dark:text-emerald-300">{formatMyr(dividend)}</summary>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">{priceText(q.annualDividend.perShare)} per share. {q.annualDividend.label} · {q.annualDividend.date}.</p>
                    {yieldPct !== null ? <p className="mt-1 text-xs font-normal text-muted-foreground">Dividend yield: {yieldPct.toFixed(1)}% at the last close.</p> : null}
                  </details> : q ? "No dividend data" : "Dividend data not loaded"}
                </dd>
              </div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Shares</dt><dd className="mt-1 font-medium">{h.shares.toLocaleString("en-MY", { maximumFractionDigits: 8 })}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Avg cost / share</dt><dd className="mt-1 font-medium">{priceText(h.averagePrice)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Latest price / share</dt><dd className="mt-1 font-medium">{priceText(q?.price ?? null)}<span className="mt-1 block text-xs font-normal text-muted-foreground">{q?.priceDate ?? "No price date"}</span></dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Cost</dt><dd className="mt-1 font-medium">{formatMyr(v.cost)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Market value</dt><dd className="mt-1 font-medium">{v.value === null ? "Unavailable" : formatMyr(v.value)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Gain RM / %</dt><dd className={`mt-1 font-medium ${v.gain !== null && v.gain < 0 ? "text-red-600 dark:text-red-300" : ""}`}>{v.gain === null ? "Unavailable" : formatMyr(v.gain)}<span className="block">{v.gainPercent === null ? "" : `${v.gainPercent.toFixed(2)}%`}</span></dd></div>
              <div className="min-w-0"><dt className="text-xs text-muted-foreground">Genesis score</dt><dd className="mt-1 font-medium">{formatScore100(q?.score ?? null)}</dd></div>
            </dl>
            <div className="mt-4 border-t pt-3">{q ? q.warnings.length ? <details><summary className="cursor-pointer text-amber-700 dark:text-amber-300">{q.warnings.length} warnings to review</summary><ul className="mt-2 list-disc space-y-2 pl-4">{q.warnings.map(w => <li key={w}>{w}</li>)}</ul></details> : "No published warnings" : "Loading research…"}</div>
          </li>;
        })}</ul>
      <div className="market-card p-5 [overflow-wrap:anywhere]"><h2 className="font-semibold">Portfolio total</h2><dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-muted-foreground">Total cost</dt><dd className="mt-1 font-semibold">{formatMyr(totals.cost)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Total market value</dt><dd className="mt-1 font-semibold">{totals.missing ? "Incomplete" : formatMyr(totals.value)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Total gain RM / %</dt><dd className="mt-1 font-semibold">{totals.missing ? "Gain unavailable — some prices are missing" : `${formatMyr(totals.value - totals.cost)} / ${((totals.value - totals.cost) / totals.cost * 100).toFixed(2)}%`}</dd></div>
      </dl></div>
    </section>}
  </>;
}
