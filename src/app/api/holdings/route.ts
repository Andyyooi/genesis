import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { scoreTicker } from "@/scoring/run-ticker";
import { loadRecentAlerts } from "@/alerts/refresh";
import { plainConcern } from "@/lib/financial-terms";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const tickers = [...new Set((new URL(request.url).searchParams.get("tickers") ?? "").split(",").filter(Boolean))];
  if (tickers.length > 1000) return Response.json({ error: "Too many holdings" }, { status: 400 });
  const universe = getDb().select({ ticker: instruments.ticker, name: instruments.name }).from(instruments).all();
  const alerts = tickers.length ? loadRecentAlerts(10000) : [];
  const quotes = tickers.map(ticker => {
    const data = scoreTicker(ticker);
    if (!data) return { ticker, price: null, priceDate: null, score: null, warnings: ["Stock is no longer in the published universe."] };
    const { result, instrument } = data;
    const bar = [...data.bars].filter(b => b.close !== null).sort((a, b) => b.barDate.localeCompare(a.barDate))[0];
    const inactive = instrument.listingStatus === "inactive";
    const warnings = [
      ...(inactive ? ["Stock is no longer listed in the published universe; showing its last stored price."] : []),
      ...(instrument.pn17 ? ["Financial distress warning (PN17)"] : []),
      ...(instrument.warningFlag ? ["Company warning flag"] : []),
      ...result.concerns.map(c => plainConcern(c.id, c.message)),
      ...result.dataConfidence.reasons,
      ...(result.dataCoverage.freshness !== "FRESH" ? [`Accounts freshness: ${result.dataCoverage.freshness.replaceAll("_", " ").toLowerCase()}`] : []),
      ...(!bar ? ["Price unavailable"] : Date.now() - Date.parse(bar.barDate) > 7 * 86400000 ? [`Stored price is over 7 days old (${bar.barDate}).`] : []),
      ...alerts.filter(a => a.ticker === ticker).map(a => `${a.title}: ${a.why}`),
    ];
    return { ticker, price: bar?.close ?? null, priceDate: bar?.barDate ?? null, score: inactive ? null : result.researchScore, warnings: [...new Set(warnings)] };
  });
  return Response.json({ universe, quotes }, { headers: { "Cache-Control": "no-store" } });
}
