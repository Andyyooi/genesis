import { getSqlite } from "@/db/client";
import { loadLatestFairValueRunsForInstruments } from "@/fair-value/load-run";
import { fairRangeHeadline } from "@/lib/fair-range";
import type { ListFairRange } from "@/lib/fair-range-summary";
import { isSnapshotReadOnly } from "@/lib/data-mode";

export function loadListFairRanges(tickers: string[]): Record<string, ListFairRange> {
  if (!tickers.length) return {};
  const sqlite = getSqlite();
  const rows = sqlite.prepare(`
    SELECT i.id, i.ticker,
      CASE WHEN json_valid(s.evidence_json) THEN
        CASE WHEN json_extract(s.evidence_json, '$.storedResult.methodology') = 'cross-sectional-v2' THEN
          (SELECT json_extract(value, '$.value') FROM json_each(s.evidence_json, '$.scoredMetrics')
           WHERE json_extract(value, '$.id') = 'last_close' LIMIT 1)
        END
      END AS lastClose
    FROM instruments i
    LEFT JOIN (SELECT instrument_id, MAX(id) AS id FROM score_runs GROUP BY instrument_id) latest ON latest.instrument_id = i.id
    LEFT JOIN score_runs s ON s.id = latest.id
    WHERE i.ticker IN (${tickers.map(() => "?").join(",")})
  `).all(...tickers) as { id: number; ticker: string; lastClose: number | null }[];
  const stored = loadLatestFairValueRunsForInstruments(sqlite, rows.map(row => row.id));
  return Object.fromEntries(rows.map(row => {
    const range = fairRangeHeadline(stored.get(row.id) ?? null, row.lastClose);
    return [row.ticker, range.available
      ? { available: true, position: range.position, positionText: range.positionText, low: range.low, high: range.high, price: range.price }
      : { available: false }];
  }));
}

let marketScanSnapshotRanges: { key: string; ranges: Record<string, ListFairRange> } | undefined;

export function loadMarketScanFairRanges(tickers: string[]): Record<string, ListFairRange> {
  if (!isSnapshotReadOnly()) return loadListFairRanges(tickers);
  const key = JSON.stringify(tickers);
  if (marketScanSnapshotRanges?.key !== key) {
    marketScanSnapshotRanges = { key, ranges: loadListFairRanges(tickers) };
  }
  return marketScanSnapshotRanges.ranges;
}
