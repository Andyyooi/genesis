import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";
import { loadDividendHistory } from "@/providers/yahoo-dividends";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker || ticker.length > 40) return Response.json({ error: "Choose a stock" }, { status: 400 });
  const instrument = getDb().select().from(instruments).where(eq(instruments.ticker, ticker)).get();
  if (!instrument) return Response.json({ error: "Stock not found" }, { status: 404 });
  const symbol = yahooSymbolCandidates(instrument)[0];
  if (!symbol) return Response.json({ error: "Dividend history is not covered for this stock." }, { status: 404 });
  try {
    return Response.json(await loadDividendHistory(symbol), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Dividend history is unavailable right now. Try again later." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
