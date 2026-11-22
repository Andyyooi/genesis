export type WatchlistReason = "Top pick" | "Big mover";
export type WatchlistEntry = { ticker: string; reason: WatchlistReason };
export type WatchlistCandidate = {
  ticker: string;
  eligible: boolean;
  lastTrade: string | null;
  close: number | null;
  score: number | null;
  marketCap: number | null;
  medianTradedValue: number | null;
  move: number | null;
};

type MovementBar = { close: number | null; adjClose: number | null };
const positive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

export function recentWatchlistMove(bars: MovementBar[]): number | null {
  if (bars.length !== 6) return null;
  const adjusted = bars.some((bar) => positive(bar.adjClose));
  const latest = adjusted ? bars[0].adjClose : bars[0].close;
  const previous = adjusted ? bars[5].adjClose : bars[5].close;
  return positive(latest) && positive(previous) ? Math.abs(latest / previous - 1) : null;
}

export function selectOverviewWatchlist(
  candidates: WatchlistCandidate[],
  settings: { min_market_cap: number; min_median_traded_value: number },
): WatchlistEntry[] {
  const latestTrade = candidates.reduce<string | null>(
    (latest, row) => row.lastTrade && (!latest || row.lastTrade > latest) ? row.lastTrade : latest,
    null,
  );
  const ready = candidates.filter((row) =>
    row.eligible && latestTrade !== null && row.lastTrade === latestTrade &&
    positive(row.close) && row.close >= 0.2 &&
    row.score !== null && Number.isFinite(row.score) &&
    positive(row.marketCap) && row.marketCap >= settings.min_market_cap &&
    positive(row.medianTradedValue) && row.medianTradedValue >= settings.min_median_traded_value,
  );
  const byScore = ready.sort((a, b) => b.score! - a.score! || a.ticker.localeCompare(b.ticker));
  const picks = byScore.slice(0, 15);
  const movers = byScore.slice(15)
    .filter((row) => positive(row.move))
    .sort((a, b) => b.move! - a.move! || a.ticker.localeCompare(b.ticker))
    .slice(0, 15);
  const movingTickers = new Set(movers.map((row) => row.ticker));
  const extraPicks = byScore.slice(15).filter((row) => !movingTickers.has(row.ticker))
    .slice(0, 30 - picks.length - movers.length);
  return [
    ...[...picks, ...extraPicks].map(({ ticker }): WatchlistEntry => ({ ticker, reason: "Top pick" })),
    ...movers.map(({ ticker }): WatchlistEntry => ({ ticker, reason: "Big mover" })),
  ];
}

export function readPublishedWatchlist(raw: string | undefined): WatchlistEntry[] {
  if (!raw) return [];
  try {
    const summary = JSON.parse(raw);
    if (summary?.methodology !== "cross-sectional-v2" || !Array.isArray(summary.overviewWatchlist)) return [];
    const entries: unknown[] = summary.overviewWatchlist;
    if (entries.length > 30) return [];
    const valid = entries.every((entry): entry is WatchlistEntry => {
      const candidate = entry as Partial<WatchlistEntry> | null;
      return typeof candidate?.ticker === "string" && candidate.ticker.length > 0 &&
        (candidate.reason === "Top pick" || candidate.reason === "Big mover");
    });
    return valid && new Set(entries.map((entry) => entry.ticker)).size === entries.length ? entries : [];
  } catch {
    return [];
  }
}
