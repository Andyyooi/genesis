import { describe, expect, it } from "vitest";
import { readPublishedWatchlist, recentWatchlistMove, selectOverviewWatchlist, type WatchlistCandidate } from "@/opportunities/watchlist-selection";

const settings = { min_market_cap: 2_000_000_000, min_median_traded_value: 1_000_000 };
function candidate(i: number, changes: Partial<WatchlistCandidate> = {}): WatchlistCandidate {
  return {
    ticker: `STOCK${i}`,
    eligible: true,
    lastTrade: "2026-11-20",
    close: 0.2,
    score: 100 - i,
    marketCap: settings.min_market_cap,
    medianTradedValue: settings.min_median_traded_value,
    move: i / 100,
    ...changes,
  };
}

describe("published Overview watchlist", () => {
  it("makes room for both research picks and large movers without repeating names", () => {
    const entries = selectOverviewWatchlist(Array.from({ length: 40 }, (_, i) => candidate(i)), settings);
    expect(entries.filter((row) => row.reason === "Top pick").map((row) => row.ticker))
      .toEqual(Array.from({ length: 15 }, (_, i) => `STOCK${i}`));
    expect(entries.filter((row) => row.reason === "Big mover").map((row) => row.ticker))
      .toEqual(Array.from({ length: 15 }, (_, i) => `STOCK${39 - i}`));
  });

  it("does not use ineligible, penny, illiquid, tiny, old or unscored stocks to fill gaps", () => {
    const entries = selectOverviewWatchlist([
      candidate(0, { eligible: false }),
      candidate(1, { close: 0.195 }),
      candidate(2, { medianTradedValue: settings.min_median_traded_value - 1 }),
      candidate(3, { marketCap: settings.min_market_cap - 1 }),
      candidate(4, { lastTrade: "2026-11-19" }),
      candidate(5, { score: null }),
      candidate(6),
    ], settings);
    expect(entries).toEqual([{ ticker: "STOCK6", reason: "Top pick" }]);
  });

  it("compares five sessions using comparable closes and measures moves in both directions", () => {
    const adjusted = [0.8, 0.9, 0.9, 0.95, 0.99, 1].map((adjClose) => ({ close: 5, adjClose }));
    expect(recentWatchlistMove(adjusted)).toBeCloseTo(0.2);
    expect(recentWatchlistMove(adjusted.slice(1))).toBeNull();
    expect(recentWatchlistMove([{ close: 5, adjClose: null }, ...adjusted.slice(1)])).toBeNull();
  });

  it("uses only a complete valid selection from the published summary", () => {
    const selection = [{ ticker: "STOCK6", reason: "Top pick" }];
    const summary = { methodology: "cross-sectional-v2", overviewWatchlist: selection };
    expect(readPublishedWatchlist(JSON.stringify(summary))).toEqual(selection);
    expect(readPublishedWatchlist(JSON.stringify({ methodology: summary.methodology }))).toEqual([]);
    expect(readPublishedWatchlist(JSON.stringify({ ...summary, overviewWatchlist: [...selection, ...selection] }))).toEqual([]);
    expect(readPublishedWatchlist("{")).toEqual([]);
  });
});
