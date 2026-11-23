"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Headline, StockNews } from "@/news/google-news";
import { useHeldTickers } from "@/components/holdings-store";

type NewsData = { fetchedAt: string; stocks: (StockNews & { held: boolean })[]; market: Headline[] | null; skipped: number };

const dateText = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }) : "Date unknown";

function useNews(query: string | null) {
  const [data, setData] = useState<NewsData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    fetch(`/api/news?${query}`, { signal: controller.signal, cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("Could not load news. Reload to try again.");
      return r.json();
    }).then(d => { setData(d); setError(""); }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [query]);
  return { data, error };
}

export function HeadlineList({ headlines, empty }: { headlines: Headline[]; empty: string }) {
  if (!headlines.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="space-y-3">{headlines.map(h => <li key={h.link} className="text-sm [overflow-wrap:anywhere]">
    <a className="font-medium underline-offset-4 hover:underline" href={h.link} target="_blank" rel="noreferrer">{h.title}</a>
    <p className="mt-0.5 text-xs text-muted-foreground">{dateText(h.publishedAt)}{h.source ? ` · ${h.source}` : ""}</p>
  </li>)}</ul>;
}

const NOTE = "Latest headlines from Google News (The Star, The Edge, NST, Bernama and others), fetched when you open this page. Headlines are matched by company name and may include related companies. News does not change the Genesis score.";

/** News section on a stock page. */
export function StockNewsSection({ ticker }: { ticker: string }) {
  const { data, error } = useNews(`tickers=${encodeURIComponent(ticker)}`);
  const stock = data?.stocks[0];
  const headlines = stock?.headlines ?? [];
  return <section aria-labelledby="stock-news" className="mt-3 space-y-2 border-t pt-3">
    <h4 id="stock-news" className="font-semibold">Latest headlines</h4>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : !data ? <p role="status" className="text-sm text-muted-foreground">Loading headlines…</p>
      : stock?.error ? <p role="alert" className="text-sm text-destructive">{stock.error}</p>
      : <HeadlineList headlines={headlines.slice(0, 2)} empty="No matching headlines found in the last 30 days." />}
    {headlines.length > 2 ? <details>
      <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">More headlines</summary>
      <div className="mt-2"><HeadlineList headlines={headlines.slice(2)} empty="" /></div>
    </details> : null}
    {headlines.length > 0 ? <p className="text-xs text-muted-foreground">Google News matches by name and may include related companies. Headlines don’t confirm why the price moved.</p> : null}
  </section>;
}

/** News page: held stocks (from this browser), watched stocks and the wider market. */
export function NewsBoard() {
  const held = useHeldTickers();
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setReady(true), 0); return () => window.clearTimeout(t); }, []);
  const tickers = [...held].sort().join(",");
  const { data, error } = useNews(ready ? `tickers=${encodeURIComponent(tickers)}&watchlist=1&market=1` : null);
  if (error) return <p role="alert" className="rounded-lg border border-red-400 p-4 text-red-700 dark:text-red-300">{error}</p>;
  if (!data) return <p className="text-muted-foreground">Loading headlines… this can take a few seconds.</p>;
  const groups = [
    { title: "Stocks you hold", rows: data.stocks.filter(s => s.held), empty: <>No holdings in this browser yet. Add them on <Link className="underline" href="/holdings">My holdings</Link>.</> },
    { title: "Watchlist", rows: data.stocks.filter(s => !s.held), empty: "No watchlist stocks." },
  ];
  return <>
    <p className="text-sm text-muted-foreground">{NOTE} Checked {new Date(data.fetchedAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" })} (Malaysia time).</p>
    <section aria-labelledby="market-news" className="market-card p-5">
      <h2 id="market-news" className="mb-4 text-xl font-semibold">Bursa Malaysia market</h2>
      <HeadlineList headlines={data.market ?? []} empty="Market headlines are unavailable right now." />
    </section>
    {groups.map(g => <section key={g.title} aria-label={g.title} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{g.title}</h2>
      {g.rows.length === 0 ? <p className="text-sm text-muted-foreground">{g.empty}</p> : <ul className="grid gap-4 lg:grid-cols-2">{g.rows.map(s => <li key={s.ticker} className="market-card min-w-0 p-5">
        <p className="mb-3"><Link className="font-semibold underline" href={`/stock/${encodeURIComponent(s.ticker)}`}>{s.ticker}</Link> <span className="text-sm text-muted-foreground">{s.name}</span></p>
        {s.error ? <p role="alert" className="text-sm text-destructive">{s.error}</p> : <HeadlineList headlines={s.headlines} empty="No headlines naming this company in the last 30 days." />}
      </li>)}</ul>}
    </section>)}
    {data.skipped > 0 ? <p className="text-sm text-muted-foreground">{data.skipped} more stocks were not checked (limit 60 per page).</p> : null}
  </>;
}
