import { getSqlite } from "@/db/client";
import { loadPersistedFairValueForPage } from "@/fair-value/load-persisted-page";
import { fairRangeHeadline, type FairRangeHeadline } from "@/lib/fair-range";

export function loadListFairRanges(tickers: string[]): Record<string, FairRangeHeadline> {
  if (!tickers.length) return {};
  const sqlite = getSqlite();
  const rows = sqlite.prepare(`
    SELECT i.id, i.ticker, s.evidence_json AS evidence
    FROM instruments i
    LEFT JOIN score_runs s ON s.id = (
      SELECT id FROM score_runs WHERE instrument_id = i.id ORDER BY id DESC LIMIT 1
    )
    WHERE i.ticker IN (${tickers.map(() => "?").join(",")})
  `).all(...tickers) as { id: number; ticker: string; evidence: string | null }[];
  return Object.fromEntries(rows.map(row => {
    let lastClose: number | null = null;
    try {
      const evidence = JSON.parse(row.evidence ?? "{}");
      if (evidence.storedResult?.methodology === "cross-sectional-v2") {
        lastClose = evidence.scoredMetrics?.find((m: { id: string }) => m.id === "last_close")?.value ?? null;
      }
    } catch { /* Unreadable scores have no last close, as on the stock page. */ }
    return [row.ticker, fairRangeHeadline(loadPersistedFairValueForPage(row.id), lastClose)];
  }));
}
