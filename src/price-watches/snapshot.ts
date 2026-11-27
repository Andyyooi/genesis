import { getSqlite } from "@/db/client";
import { loadPersistedFairValueForPage } from "@/fair-value/load-persisted-page";
import { fairRangeHeadline } from "@/lib/fair-range";
import { malaysiaMarketDate } from "@/refresh/types";

export function loadWatchInstrument(ticker: string) {
  return getSqlite().prepare("SELECT id FROM instruments WHERE ticker = ?").get(ticker) as { id: number } | undefined;
}

export function loadWatchCloses(instrumentId: number) {
  return getSqlite().prepare(`
    SELECT bar_date AS date, close FROM price_bars
    WHERE instrument_id = ? AND bar_date <= ? AND source = 'yahoo'
      AND close > 0 AND close <= 1.7976931348623157e308 AND date(bar_date, '+0 days') = bar_date
      AND datetime(retrieved_at) >= datetime(bar_date, '+9 hours')
    ORDER BY bar_date DESC LIMIT 2
  `).all(instrumentId, malaysiaMarketDate(new Date())) as { date: string; close: number }[];
}

export function loadWatchRange(instrumentId: number) {
  const range = fairRangeHeadline(loadPersistedFairValueForPage(instrumentId), null);
  return range.available ? { low: range.low, high: range.high } : undefined;
}
