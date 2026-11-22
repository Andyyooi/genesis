import type { companyCalendar, dividendAnnouncements } from "@/db/schema";

export type CalendarStock = {
  ticker: string;
  name: string;
  watchlist: boolean;
  dates: typeof companyCalendar.$inferSelect | null;
  announcedDividends?: (typeof dividendAnnouncements.$inferSelect)[];
};

export type CalendarScope = "holdings" | "watchlist" | "all";

export function calendarAgenda(stocks: CalendarStock[], scope: CalendarScope, held: ReadonlySet<string>, today: string) {
  const scoped = stocks.filter((stock) => scope === "all" ||
    (scope === "watchlist" ? stock.watchlist : held.has(stock.ticker)));
  const results = scoped.flatMap(({ ticker, name, dates }) =>
    dates?.resultsFrom && dates.resultsThrough && dates.resultsThrough >= today
      ? [{ ticker, name, sortDate: dates.resultsFrom, from: dates.resultsFrom, through: dates.resultsThrough, estimated: dates.resultsEstimated }]
      : []);
  const dividends = scoped.flatMap(({ ticker, name, dates, announcedDividends = [] }) => {
    const entries: {
      sourceId: string | null; exDate: string | null; paymentDate: string | null;
      dividendAmount: number | null; dividendCurrency: string | null;
    }[] = announcedDividends.map(({ sourceId, exDate, paymentDate, amountMyr }) => ({
      sourceId, exDate, paymentDate, dividendAmount: amountMyr, dividendCurrency: "MYR",
    }));
    if (dates) {
      const { exDate, paymentDate, dividendAmount, dividendCurrency } = dates;
      const matches = entries.filter((event) => exDate
        ? event.exDate === exDate
        : paymentDate && event.paymentDate === paymentDate);
      if (!matches.length) {
        entries.push({ sourceId: null, exDate, paymentDate, dividendAmount, dividendCurrency });
      } else if (matches.length === 1 && exDate) {
        const [event] = matches;
        event.paymentDate ??= paymentDate;
        if (event.dividendAmount === null && dividendAmount !== null) {
          event.dividendAmount = dividendAmount;
          event.dividendCurrency = dividendCurrency;
        }
      }
    }
    return entries.flatMap((event) => {
      const sortDate = nextDividendDate(event.exDate, event.paymentDate, today);
      return sortDate ? [{ ...event, ticker, name, sortDate, annualYieldPercent: dates?.annualYieldPercent ?? null }] : [];
    });
  });
  const byDate = (a: { sortDate: string; ticker: string }, b: { sortDate: string; ticker: string }) =>
    a.sortDate.localeCompare(b.sortDate) || a.ticker.localeCompare(b.ticker);
  return { results: results.sort(byDate), dividends: dividends.sort(byDate) };
}

function nextDividendDate(exDate: string | null, paymentDate: string | null, today: string) {
  return exDate && exDate >= today ? exDate : paymentDate && paymentDate >= today ? paymentDate : null;
}
