import { getSqlite } from "@/db/client";
import {
  summariseMarketPrices,
  validClose,
  type MarketPricePair,
  type PricePoint,
} from "@/lib/price-history";

export function loadMarketPricePulse() {
  const rows = getSqlite()
    .prepare(
      `
    WITH latest AS (
      SELECT i.id,
        (SELECT p.bar_date FROM price_bars p WHERE p.instrument_id = i.id AND p.source = 'yahoo'
         ORDER BY p.bar_date DESC LIMIT 1) AS date
      FROM instruments i WHERE i.listing_status = 'listed'
    )
    SELECT latest.date, p.close,
      (SELECT previous.close FROM price_bars previous
       WHERE previous.instrument_id = latest.id AND previous.source = 'yahoo' AND previous.bar_date < latest.date
       ORDER BY previous.bar_date DESC LIMIT 1) AS previousClose
    FROM latest LEFT JOIN price_bars p
      ON p.instrument_id = latest.id AND p.bar_date = latest.date AND p.source = 'yahoo'
  `,
    )
    .all() as MarketPricePair[];
  return summariseMarketPrices(rows);
}

/** Read only published Yahoo observations. No network requests or writes. */
export function loadSavedPrices(ticker: string, limit = 260): PricePoint[] {
  const rows = getSqlite()
    .prepare(
      `
    SELECT bar_date AS date, close FROM price_bars
    WHERE instrument_id = (SELECT id FROM instruments WHERE ticker = ?)
      AND source = 'yahoo'
    ORDER BY bar_date DESC LIMIT ?
  `,
    )
    .all(ticker, limit) as PricePoint[];
  return rows.reverse().map((row) => ({
    date: row.date,
    close: validClose(row.close) ? row.close : null,
  }));
}
