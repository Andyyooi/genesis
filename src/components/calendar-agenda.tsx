"use client";

import Link from "next/link";
import { Banknote, CalendarDays } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useHeldTickers } from "@/components/holdings-store";
import { calendarAgenda, type CalendarScope, type CalendarStock } from "@/lib/company-calendar";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const displayDate = (date: string | null) => date ? dateFormat.format(new Date(date)) : "Not available";
const scopes = [
  { id: "holdings", label: "My holdings" },
  { id: "watchlist", label: "Watchlist" },
  { id: "all", label: "All tracked stocks" },
] as const;
const pageSize = 10;
const i3Detail = "https://klse.i3investor.com/web/entitlement/detail/";

export function CalendarAgenda({ stocks, today, checkedOn, incomplete }: {
  stocks: CalendarStock[];
  today: string;
  checkedOn: string | null;
  incomplete: boolean;
}) {
  const held = useHeldTickers();
  const [choice, setChoice] = useState<CalendarScope | null>(null);
  const scope = choice ?? (held.size ? "holdings" : stocks.some((stock) => stock.watchlist) ? "watchlist" : "all");
  const { dividends, results } = calendarAgenda(stocks, scope, held, today);
  const empty = !checkedOn
    ? "No calendar dates have been loaded yet."
    : "No upcoming dates are available for these stocks. They may not have been announced or may not be covered yet.";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Stocks to show" className="flex flex-wrap gap-1 rounded-xl border bg-white p-1">
          {scopes.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setChoice(id)} aria-pressed={scope === id}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 aria-pressed:bg-slate-900 aria-pressed:text-white">
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Yahoo Finance and I3investor{checkedOn ? ` · Last checked ${displayDate(checkedOn)}` : ""}
        </p>
      </div>
      {incomplete && <p className="rounded-lg border bg-white px-4 py-3 text-sm text-muted-foreground">
        The last refresh couldn&apos;t check every stock. Some dates may be missing or out of date.
      </p>}
      {scope === "holdings" && held.size === 0 ? (
        <p className="market-card p-6">No holdings are saved in this browser. <Link href="/holdings" className="underline underline-offset-4">Add your holdings</Link> or choose another list above.</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <AgendaSection key={`dividends-${scope}`} title="Upcoming dividends" icon={<Banknote className="size-5" aria-hidden="true" />}
            help="Buy before the ex-dividend date to qualify. The payment date is when the company pays. Yield is annual, not for a single payout." count={dividends.length} empty={empty}
            render={(limit) => dividends.slice(0, limit).map((row) => (
              <li key={row.sourceId ?? row.ticker} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <StockTitle ticker={row.ticker} name={row.name} />
                  {row.sourceId && <a href={i3Detail + encodeURIComponent(row.sourceId)} className="text-xs text-muted-foreground underline underline-offset-4">Dividend details</a>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-sm sm:grid-cols-4">
                  <Metric label="Ex-dividend date">{displayDate(row.exDate)}</Metric>
                  <Metric label="Payment date">{displayDate(row.paymentDate)}</Metric>
                  <Metric label="Cash per share">{row.dividendAmount !== null && row.dividendCurrency
                    ? new Intl.NumberFormat("en-MY", { style: "currency", currency: row.dividendCurrency, maximumFractionDigits: 4 }).format(row.dividendAmount)
                    : "Not available"}</Metric>
                  <Metric label="Annual yield">{row.annualYieldPercent !== null ? `${row.annualYieldPercent.toFixed(2)}%` : "Not available"}</Metric>
                </dl>
              </li>
            ))} />
          <AgendaSection key={`results-${scope}`} title="Upcoming results" icon={<CalendarDays className="size-5" aria-hidden="true" />}
            help="Estimated results dates may change. Check the company announcement before relying on a date." count={results.length} empty={empty}
            render={(limit) => results.slice(0, limit).map((row) => (
              <li key={row.ticker} className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 px-5 py-4">
                <StockTitle ticker={row.ticker} name={row.name} />
                <div className="text-sm">
                  <p className="font-medium">{displayDate(row.from)}{row.through !== row.from ? ` – ${displayDate(row.through)}` : ""}</p>
                  {row.estimated && <p className="text-muted-foreground">Estimated</p>}
                </div>
              </li>
            ))} />
        </div>
      )}
    </>
  );
}

function StockTitle({ ticker, name }: { ticker: string; name: string }) {
  return <div className="min-w-0 max-w-full">
    <Link href={`/stock/${encodeURIComponent(ticker)}`} className="font-semibold hover:underline">{ticker}</Link>
    <p className="text-sm text-muted-foreground">{name}</p>
  </div>;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{children}</dd></div>;
}

function AgendaSection({ title, icon, help, count, empty, render }: {
  title: string;
  icon: ReactNode;
  help: string;
  count: number;
  empty: string;
  render: (limit: number) => ReactNode;
}) {
  const [limit, setLimit] = useState(pageSize);
  return <section className="market-card">
    <div className="border-b px-5 py-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">{icon}{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{help}</p>
    </div>
    {count ? <ul className="divide-y">{render(limit)}</ul> : <p className="p-5 text-sm text-muted-foreground">{empty}</p>}
    {limit < count && <div className="border-t px-5 py-3">
      <button type="button" className="text-sm font-medium underline underline-offset-4" onClick={() => setLimit(limit + pageSize)}>
        Show more {title.toLowerCase()} ({count - limit} left)
      </button>
    </div>}
  </section>;
}
