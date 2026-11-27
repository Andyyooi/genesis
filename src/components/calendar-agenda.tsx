"use client";

import Link from "next/link";
import { Banknote, CalendarDays } from "lucide-react";
import { useState, type ReactNode } from "react";
import { usePortfolio } from "@/components/holdings-store";
import { calendarAgenda, type CalendarScope, type CalendarStock } from "@/lib/company-calendar";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const displayDate = (date: string | null) => date ? dateFormat.format(new Date(date)) : "Not available";
const scopes = [
  { id: "holdings", label: "My holdings" },
  { id: "watchlist", label: "Watchlist" },
  { id: "all", label: "All tracked stocks" },
] as const;
const pageSize = 10;

export function CalendarAgenda({ stocks, today, checkedOn, incomplete }: {
  stocks: CalendarStock[];
  today: string;
  checkedOn: string | null;
  incomplete: boolean;
}) {
  const saved = usePortfolio();
  const held = new Set(saved.portfolio.holdings.map(h => h.ticker));
  const [choice, setChoice] = useState<CalendarScope | null>(null);
  const scope = choice ?? (held.size ? "holdings" : stocks.some((stock) => stock.watchlist) ? "watchlist" : "all");
  const { dividends, results } = calendarAgenda(stocks, scope, held, today);
  const empty = !checkedOn
    ? "No calendar dates have been loaded yet."
    : "No upcoming dates are available for these stocks. They may not have been announced or may not be covered yet.";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Stocks to show" className="flex flex-wrap gap-1 rounded-xl border bg-card p-1">
          {scopes.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setChoice(id)} aria-pressed={scope === id}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted aria-pressed:bg-accent aria-pressed:text-primary">
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Yahoo Finance{checkedOn ? ` · Last checked ${displayDate(checkedOn)}` : ""}
        </p>
      </div>
      {incomplete && <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        The last refresh couldn&apos;t check every stock. Some dates may be missing or out of date.
      </p>}
      {scope === "holdings" && held.size === 0 ? (
        <p className="market-card p-6">{saved.mode === "loading" ? "Loading your holdings…" : saved.mode === "error" ? "Could not load your holdings." : <><Link href="/holdings" className="underline underline-offset-4">Add your holdings</Link> to see their dates here, or choose another list above.</>}</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <AgendaSection key={`dividends-${scope}`} title="Upcoming dividends" icon={<Banknote className="size-5" aria-hidden="true" />}
            help={<>Buy before the ex-dividend date to qualify. Yield is annual, not for a single payout.{" "}
              <a href="https://www.bursamalaysia.com/market_information/announcements/entitlement_by_ex_date" className="underline underline-offset-4">Check payment dates on Bursa Malaysia</a>.
            </>} count={dividends.length} empty={empty}
            render={(limit) => dividends.slice(0, limit).map((row) => (
              <li key={row.ticker} className="px-5 py-4">
                <StockTitle ticker={row.ticker} name={row.name} />
                <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-sm sm:grid-cols-4">
                  <Metric label="Ex-dividend date">{displayDate(row.exDate)}</Metric>
                  <Metric label="Payment date">{displayDate(row.paymentDate)}</Metric>
                  <Metric label="Cash per share">{row.dividendAmount !== null && row.dividendCurrency
                    ? new Intl.NumberFormat("en-MY", { style: "currency", currency: row.dividendCurrency, maximumFractionDigits: 4 }).format(row.dividendAmount)
                    : "Not available"}</Metric>
                  <Metric label="Dividend yield">{row.yield
                    ? <>{row.yield.percent.toFixed(2)}% <span className="block text-xs">{row.yield.basis}</span></>
                    : "Not available"}</Metric>
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
  help: ReactNode;
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
