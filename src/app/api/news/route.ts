import { getDb } from "@/db/client";
import { loadWatchlistMembership } from "@/db/queries";
import { instruments } from "@/db/schema";
import { marketNews, newsForStocks } from "@/news/google-news";

export const dynamic = "force-dynamic";
const MAX_STOCKS = 60;

/** Headlines for the requested stocks (held stocks come from the browser), plus watched stocks when asked. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = [...new Set((params.get("tickers") ?? "").split(",").map(t => t.trim().toUpperCase()).filter(Boolean))];
  const rows = getDb().select({ ticker: instruments.ticker, name: instruments.name }).from(instruments).all();
  const byTicker = new Map(rows.map(r => [r.ticker, r]));
  const held = requested.flatMap(t => byTicker.get(t) ?? []);
  const watched = params.get("watchlist") === "1" ? loadWatchlistMembership().filter(r => !requested.includes(r.ticker)) : [];
  const stocks = [...held, ...watched].slice(0, MAX_STOCKS);
  const [news, market] = await Promise.all([newsForStocks(stocks), params.get("market") === "1" ? marketNews() : Promise.resolve(null)]);
  return Response.json({
    fetchedAt: new Date().toISOString(),
    stocks: news.map((n, i) => ({ ...n, held: i < held.length })),
    market,
    skipped: [...held, ...watched].length - stocks.length,
  }, { headers: { "Cache-Control": "no-store" } });
}
