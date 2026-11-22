import { getDb, getSqlite } from "@/db/client";
import { trackRecordEntries } from "@/db/schema";

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const positivePrice = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function loadTrackRecord() {
  const stored = getDb().select().from(trackRecordEntries).all();
  const latestPrice = getSqlite().prepare(`SELECT p.close, p.adj_close adjClose, p.bar_date date FROM price_bars p JOIN instruments i ON i.id = p.instrument_id WHERE i.ticker = ? AND p.bar_date >= ? AND p.source = 'yahoo' ORDER BY p.bar_date DESC LIMIT 1`);
  const entryPrice = getSqlite().prepare(`SELECT p.adj_close adjClose FROM price_bars p JOIN instruments i ON i.id = p.instrument_id WHERE i.ticker = ? AND p.bar_date = ? AND p.source = 'yahoo'`);
  const entries = stored.map((entry) => {
    const latest = latestPrice.get(entry.ticker, entry.pickDate) as { close: number | null; adjClose: number | null; date: string } | undefined;
    const historical = entryPrice.get(entry.ticker, entry.pickDate) as { adjClose: number | null } | undefined;
    const adjusted = positivePrice(historical?.adjClose) && positivePrice(latest?.adjClose);
    const start = adjusted ? historical.adjClose : entry.entryClose;
    const end = adjusted ? latest.adjClose : latest?.close;
    const priceReturn = positivePrice(start) && positivePrice(end) ? end / start - 1 : null;
    return { ...entry, latestDate: latest?.date ?? null, latestClose: positivePrice(latest?.close) ? latest.close : null, priceReturn };
  });
  const dates = [...new Set(entries.map((entry) => entry.pickDate))].sort().reverse().map((pickDate) => {
    const group = entries.filter((entry) => entry.pickDate === pickDate);
    const summarize = (basket: string) => {
      const rows = group.filter((entry) => entry.basket === basket);
      const returns = rows.flatMap((entry) => entry.priceReturn === null ? [] : [entry.priceReturn]);
      return { priceReturn: average(returns), count: returns.length, excluded: rows.length - returns.length };
    };
    const picks = summarize("top-picks");
    const basket = summarize("big-companies");
    return { pickDate, picks, basket, difference: picks.priceReturn !== null && basket.priceReturn !== null ? picks.priceReturn - basket.priceReturn : null };
  });
  return {
    dates,
    latestPicks: entries.filter((entry) => entry.pickDate === dates[0]?.pickDate && entry.basket === "top-picks").sort((a, b) => a.rank - b.rank),
    summary: {
      count: dates.length,
      pickReturn: average(dates.flatMap((date) => date.picks.priceReturn === null ? [] : [date.picks.priceReturn])),
      basketReturn: average(dates.flatMap((date) => date.basket.priceReturn === null ? [] : [date.basket.priceReturn])),
      beatCount: dates.filter((date) => date.difference !== null && date.difference > 0).length,
      comparableCount: dates.filter((date) => date.difference !== null).length,
      excluded: entries.filter((entry) => entry.priceReturn === null).length,
    },
  };
}
