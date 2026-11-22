"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { backupJson, HOLDINGS_KEY, holdingValue, mergeHolding, parseBackup, validateHolding, type Holding } from "@/lib/holdings";
import { formatMyr } from "@/lib/format-myr";
import { formatScore100 } from "@/lib/research-copy";

type Quote = { ticker: string; price: number | null; priceDate: string | null; score: number | null; warnings: string[] };
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
  const totals = (rows ?? []).reduce((sum, h) => {
    const v = holdingValue(h, data?.quotes.find(q => q.ticker === h.ticker)?.price ?? null);
    return { cost: sum.cost + v.cost, value: sum.value + (v.value ?? 0), missing: sum.missing || v.value === null };
  }, { cost: 0, value: 0, missing: false });
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
    <form className="market-card flex flex-wrap items-end gap-4 p-5" onSubmit={e => {
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
      <label className="flex flex-col gap-2 text-sm">Stock ticker or name<input className="rounded border bg-background p-2" list="stock-universe" required value={stock} onChange={e => setStock(e.target.value)} placeholder="e.g. MAYBANK" /></label>
      <datalist id="stock-universe">{data?.universe.map(s => <option key={s.ticker} value={s.ticker}>{s.name}</option>)}</datalist>
      <label className="flex flex-col gap-2 text-sm">Number of shares<input className="rounded border bg-background p-2" type="number" step="any" min="0" required value={shares} onChange={e => setShares(e.target.value)} /></label>
      <label className="flex flex-col gap-2 text-sm">Average price paid (RM per share)<input className="rounded border bg-background p-2" type="number" step="any" min="0" required value={average} onChange={e => setAverage(e.target.value)} placeholder="0.245" /></label>
      <button className={`${button} bg-primary text-primary-foreground`} disabled={!data || rows === null}>{editing ? "Save changes" : "Add holding"}</button>
      {editing && <button type="button" className={button} onClick={reset}>Cancel</button>}
    </form>
    {rows?.length === 0 ? <section className="market-card p-8"><h2 className="text-xl font-semibold">Start with a stock you own</h2><p className="mt-2 text-muted-foreground">Enter your shares and average price above. Your holdings stay in this browser. No account or server changes needed.</p></section> : rows === null ? <p>Waiting for browser storage. If it cannot be read, restore a backup above.</p> : <section className="market-card overflow-x-auto p-4">
      <table className="w-full text-sm text-left"><caption className="mb-4 text-left text-muted-foreground">Stored prices, not live quotes. Gains exclude fees and dividends. Genesis scores are research scores out of 100, not buy signals.</caption>
        <thead><tr>{["Company", "Shares", "Avg cost / share", "Latest price / date", "Cost", "Market value", "Gain RM / %", "Genesis score", "Warnings", "Actions"].map(t => <th className="p-3 border-b" key={t}>{t}</th>)}</tr></thead>
        <tbody>{rows.map(h => {
          const q = data?.quotes.find(q => q.ticker === h.ticker);
          const v = holdingValue(h, q?.price ?? null);
          return <tr key={h.ticker} className="border-b align-top"><td className="p-3 min-w-40"><Link className="font-semibold underline" href={`/stock/${encodeURIComponent(h.ticker)}`}>{h.ticker}</Link><div className="mt-1 text-muted-foreground">{data?.universe.find(s => s.ticker === h.ticker)?.name}</div></td><td className="p-3">{h.shares.toLocaleString("en-MY", { maximumFractionDigits: 8 })}</td><td className="p-3 whitespace-nowrap">{priceText(h.averagePrice)}</td><td className="p-3 whitespace-nowrap">{priceText(q?.price ?? null)}<div className="text-xs text-muted-foreground mt-1">{q?.priceDate ?? "No price date"}</div></td><td className="p-3 whitespace-nowrap">{formatMyr(v.cost)}</td><td className="p-3 whitespace-nowrap">{v.value === null ? "Unavailable" : formatMyr(v.value)}</td><td className={`p-3 whitespace-nowrap ${v.gain !== null && v.gain < 0 ? "text-red-600 dark:text-red-300" : ""}`}>{v.gain === null ? "Unavailable" : formatMyr(v.gain)}<div>{v.gainPercent === null ? "" : `${v.gainPercent.toFixed(2)}%`}</div></td><td className="p-3">{formatScore100(q?.score ?? null)}</td><td className="p-3 min-w-56 max-w-xs">{q ? q.warnings.length ? <details><summary className="cursor-pointer text-amber-700 dark:text-amber-300">{q.warnings.length} warnings to review</summary><ul className="list-disc pl-4 mt-2 space-y-2">{q.warnings.map(w => <li key={w}>{w}</li>)}</ul></details> : "No published warnings" : "Loading research…"}</td><td className="p-3"><div className="flex gap-2"><button className={button} onClick={() => { setEditing(h.ticker); setStock(h.ticker); setShares(String(h.shares)); setAverage(String(h.averagePrice)); }}>Edit</button><button className={button} onClick={() => { if (window.confirm(`Remove ${h.ticker}?`)) { if (save(rows.filter(r => r.ticker !== h.ticker))) reset(); } }}>Remove</button></div></td></tr>;
        })}</tbody>
        <tfoot><tr className="font-semibold"><th className="p-3" colSpan={4}>Total</th><td className="p-3 whitespace-nowrap">{formatMyr(totals.cost)}</td><td className="p-3 whitespace-nowrap">{totals.missing ? "Incomplete" : formatMyr(totals.value)}</td><td className="p-3 whitespace-nowrap" colSpan={4}>{totals.missing ? "Gain unavailable — some prices are missing" : `${formatMyr(totals.value - totals.cost)} / ${((totals.value - totals.cost) / totals.cost * 100).toFixed(2)}%`}</td></tr></tfoot>
      </table>
    </section>}
  </>;
}
