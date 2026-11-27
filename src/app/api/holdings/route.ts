import { eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/db/client";
import { companyCalendar, instruments } from "@/db/schema";
import { scoreTicker } from "@/scoring/run-ticker";
import { loadRecentAlerts } from "@/alerts/refresh";
import { plainConcern } from "@/lib/financial-terms";
import { loadListFairRanges } from "@/fair-value/load-list-ranges";
import { annualDividend } from "@/lib/holding-dividends";
import { goodCompanyPriceDown } from "@/lib/price-drop-flag";
import { holdingSignals } from "@/lib/holding-signals";
import { loadHoldingPublicationChanges } from "@/lib/holding-publication-changes";
import { evaluateSavedWatch } from "@/price-watches/evaluate-saved";
import { getPriceWatchStore } from "@/price-watches/store";
import type { PriceWatch } from "@/price-watches/watch";
import { formatSharePrice } from "@/lib/format-myr";
import { MAX_HOLDINGS, MAX_STARS } from "@/lib/portfolio";
import { toStatementSnapshots } from "@/metrics/from-snapshots";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tickers = [...new Set((new URL(request.url).searchParams.get("tickers") ?? "").split(",").filter(Boolean))];
  if (tickers.length > MAX_HOLDINGS + MAX_STARS) return Response.json({ error: "Too many tracked stocks" }, { status: 400 });
  const db = getDb();
  const universe = db.select({ ticker: instruments.ticker, name: instruments.name }).from(instruments).all();
  const alerts = tickers.length ? loadRecentAlerts(10000) : [];
  const fairRanges = loadListFairRanges(tickers);
  const publicationChanges = tickers.length ? loadHoldingPublicationChanges(getSqlite()) : () => [];
  const watches = new Map<string, PriceWatch>();
  let watchesUnavailable = false;
  if (tickers.length) {
    try {
      for (const watch of await getPriceWatchStore()?.list() ?? []) watches.set(watch.ticker, watch);
    } catch {
      watchesUnavailable = true;
    }
  }
  const quotes = tickers.map(ticker => {
    const data = scoreTicker(ticker);
    if (!data) return { ticker, signals: [], price: null, priceDate: null, score: null, annualDividend: null, warnings: ["Stock is no longer in the published universe."] };
    const { result, instrument } = data;
    const bar = [...data.bars].filter(b => b.close !== null).sort((a, b) => b.barDate.localeCompare(a.barDate))[0];
    const calendar = db.select({ annualYieldPercent: companyCalendar.annualYieldPercent, checkedAt: companyCalendar.checkedAt })
      .from(companyCalendar).where(eq(companyCalendar.instrumentId, instrument.id)).get();
    const price = bar?.close ?? null;
    const inactive = instrument.listingStatus === "inactive";
    const signals = holdingSignals({
      range: fairRanges[ticker],
      priceDown: goodCompanyPriceDown({
        result, bars: data.bars, periods: data.periods, pn17: instrument.pn17,
        includeSales: result.researchProfile !== "BANK" && result.profile !== "bank",
      }),
      priceDate: bar?.barDate ?? null,
      periods: toStatementSnapshots(data.periods),
      inactive,
    });
    if (!inactive) {
      signals.push(...publicationChanges(instrument.id));
      const watch = watches.get(ticker);
      if (watch) {
        const { latest, result } = evaluateSavedWatch(watch, instrument.id);
        if (latest && result.status === "triggered") {
          signals.push({
            kind: "watch-triggered", title: "Price watch triggered", date: latest.date,
            why: watch.kind === "target"
              ? `The saved close of ${formatSharePrice(latest.close)} reached your target of ${formatSharePrice(watch.target)} or less.`
              : `The saved close of ${formatSharePrice(latest.close)} entered the Genesis fair range.`,
          });
        }
      }
    }
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
    return { ticker, signals, fairRange: fairRanges[ticker], price, priceDate: bar?.barDate ?? null, score: inactive ? null : result.researchScore, annualDividend: annualDividend(instrument.currency, data.periods, price, calendar), warnings: [...new Set(warnings)] };
  });
  return Response.json({ universe, quotes, watchesUnavailable }, { headers: { "Cache-Control": "private, no-store" } });
}
