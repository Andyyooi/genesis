import type { companyCalendar } from "@/db/schema";

export type CalendarStock = {
  ticker: string;
  name: string;
  watchlist: boolean;
  dates: typeof companyCalendar.$inferSelect | null;
};

export type CalendarScope = "holdings" | "watchlist" | "all";

export function calendarAgenda(stocks: CalendarStock[], scope: CalendarScope, held: ReadonlySet<string>, today: string) {
  const scoped = stocks.filter((stock) => scope === "all" ||
    (scope === "watchlist" ? stock.watchlist : held.has(stock.ticker)));
  const results = scoped.flatMap(({ ticker, name, dates }) =>
    dates?.resultsFrom && dates.resultsThrough && dates.resultsThrough >= today
      ? [{ ticker, name, sortDate: dates.resultsFrom, from: dates.resultsFrom, through: dates.resultsThrough, estimated: dates.resultsEstimated }]
      : []);
  const dividends = scoped.flatMap(({ ticker, name, dates }) => {
    if (!dates) return [];
    const { exDate, paymentDate, dividendAmount, dividendCurrency, annualYieldPercent } = dates;
    const sortDate = nextDividendDate(exDate, paymentDate, today);
    return sortDate ? [{ ticker, name, sortDate, exDate, paymentDate, dividendAmount, dividendCurrency, annualYieldPercent }] : [];
  });
  const byDate = (a: { sortDate: string; ticker: string }, b: { sortDate: string; ticker: string }) =>
    a.sortDate.localeCompare(b.sortDate) || a.ticker.localeCompare(b.ticker);
  return { results: results.sort(byDate), dividends: dividends.sort(byDate) };
}

function nextDividendDate(exDate: string | null, paymentDate: string | null, today: string) {
  return exDate && exDate >= today ? exDate : paymentDate && paymentDate >= today ? paymentDate : null;
}
