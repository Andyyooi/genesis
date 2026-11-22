import { getSqlite } from "@/db/client";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import { loadLatestMarketScan } from "@/market/scan";
import { loadTopPicks } from "@/opportunities/top-picks";

export function recordTrackRecord() {
  if (isSnapshotReadOnly()) return 0;
  const { summary, rows } = loadLatestMarketScan();
  if (!summary) return 0;
  const dates = rows.map((row) => row.lastTrade).filter((date): date is string => typeof date === "string" && date <= summary.asOf.slice(0, 10));
  const pickDate = dates.sort().at(-1);
  if (!pickDate) return 0;
  const sqlite = getSqlite();
  const close = sqlite.prepare(`SELECT p.close FROM price_bars p JOIN instruments i ON i.id = p.instrument_id WHERE i.ticker = ? AND p.bar_date = ? AND p.source = 'yahoo'`);
  const entryClose = (ticker: string) => {
    const price = (close.get(ticker, pickDate) as { close: number } | undefined)?.close;
    return price !== undefined && Number.isFinite(price) && price > 0 ? price : null;
  };
  const picks = loadTopPicks().picks;
  const caps = sqlite.prepare(`SELECT i.ticker, s.evidence_json evidence FROM instruments i JOIN score_runs s ON s.instrument_id = i.id WHERE i.listing_status = 'listed' AND s.as_of = ? ORDER BY s.id DESC`).all(summary.asOf) as { ticker: string; evidence: string }[];
  const seen = new Set<string>();
  const companies: { ticker: string; cap: number; price: number }[] = [];
  for (const row of caps) {
    if (seen.has(row.ticker)) continue;
    seen.add(row.ticker);
    const evidence = JSON.parse(row.evidence);
    const cap = evidence.scoredMetrics?.find((metric: { id: string; available: boolean }) => metric.id === "market_cap" && metric.available)?.value;
    const price = entryClose(row.ticker);
    if (typeof cap === "number" && Number.isFinite(cap) && cap > 0 && price !== null) companies.push({ ticker: row.ticker, cap, price });
  }
  const basket = companies.sort((a, b) => b.cap - a.cap || a.ticker.localeCompare(b.ticker)).slice(0, 30);
  const entries = picks.flatMap((pick, index) => {
    const price = entryClose(pick.ticker);
    return price === null ? [] : [{ ticker: pick.ticker, rank: index + 1, score: pick.selectionScore, price, basket: "top-picks" }];
  }).concat(basket.map((company, index) => ({ ticker: company.ticker, rank: index + 1, score: null, price: company.price, basket: "big-companies" })));
  const recordedAt = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM track_record_entries WHERE pick_date = ?").run(pickDate);
    const insert = sqlite.prepare("INSERT INTO track_record_entries (pick_date, basket, ticker, rank, score, entry_close, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const entry of entries) insert.run(pickDate, entry.basket, entry.ticker, entry.rank, entry.score, entry.price, recordedAt);
  })();
  return entries.length;
}
