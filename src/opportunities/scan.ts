import { buyScoreValue } from "@/lib/buy-score";
import { publishedBuyScore } from "@/scoring/published-research-scores";
import { loadWatchlistMembership } from "@/db/queries";
import { loadSavedPrices } from "@/db/price-history";
import type { WorkspaceRow } from "@/components/research/research-workspace";
import type { WatchlistReason } from "@/opportunities/watchlist-selection";
import { latestAnnualPeriod } from "@/lib/snapshot-dates";
import type { MetricValue } from "@/metrics/types";
import {
  categoryScore,
  liveCoverage,
  mainConcernLabel,
  type OpportunityRow,
} from "@/opportunities/lists";
import { scoreTicker } from "@/scoring/run-ticker";
import { getSqlite } from "@/db/client";
import { seedUniverseFromYaml } from "@/db/seed";

function metric(metrics: MetricValue[], id: string): MetricValue | undefined {
  return metrics.find((m) => m.id === id);
}

const SCAN_CACHE_MS = 15_000;
let scanCache: { at: number; version: number; rows: OpportunityRow[] } | null = null;

export function scanWatchlist(): OpportunityRow[] {
  const version = (getSqlite().prepare("SELECT COALESCE(MAX(id), 0) AS version FROM score_runs").get() as { version: number }).version;
  if (scanCache && scanCache.version === version && Date.now() - scanCache.at < SCAN_CACHE_MS) {
    return scanCache.rows;
  }
  seedUniverseFromYaml();
  const rows = loadWatchlistMembership().flatMap((item) => loadOpportunity(item.ticker, item.reason) ?? []);
  scanCache = { at: Date.now(), version, rows };
  return rows;
}

export function loadOpportunity(ticker: string, watchlistReason: WatchlistReason | null = null): OpportunityRow | null {
    const scored = scoreTicker(ticker, false, { attachValuationContext: false });
    if (!scored) return null;
    const lastClose = metric(scored.metrics, "last_close");
    const lastTrade = metric(scored.metrics, "last_trade_date");
    const dist = metric(scored.metrics, "distance_from_52w_high");
    const buyScore = buyScoreValue(publishedBuyScore({
      researchScore: scored.result.researchScore,
      eligible: scored.result.eligibility?.eligible === true,
      needsVerification: scored.result.dataConfidence.needsVerification,
    }));
    return {
      ticker: scored.instrument.ticker,
      watchlistReason,
      name: scored.instrument.name,
      instrumentType: scored.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
      pn17: scored.instrument.pn17,
      shariahCompliant: scored.instrument.shariahCompliant ?? null,
      listingBoard: scored.instrument.listingBoard ?? null,
      marketCap: metric(scored.metrics, "market_cap")?.available
        ? (metric(scored.metrics, "market_cap")?.value ?? null)
        : null,
      sector: scored.instrument.sector ?? null,
      researchProfile: scored.result.researchProfile,
      price: lastClose?.available ? lastClose.value : null,
      buyScore,
      lastTradeDate: lastTrade?.period ?? scored.bars[0]?.barDate ?? null,
      fundamentalsPeriod: latestAnnualPeriod(scored.periods),
      researchScore: scored.result.researchScore,
      valuationScore: scored.result.valuationScore,
      qualityScore: categoryScore(scored.result, "quality"),
      growthScore: categoryScore(scored.result, "growth"),
      healthScore: categoryScore(scored.result, "financial_health"),
      coverage: liveCoverage(scored.result),
      coreCoverageRatio: scored.result.dataCoverage.coverageRatio,
      freshness: scored.result.dataCoverage.freshness,
      confidence: scored.result.dataConfidence.level,
      needsVerification: scored.result.dataConfidence.needsVerification,
      coreCoverageLabel: `${Math.round(scored.result.dataCoverage.coverageRatio * 100)}% (${scored.result.dataCoverage.available}/${scored.result.dataCoverage.expected})`,
      mainConcern: mainConcernLabel(scored.result),
      distanceFrom52wHigh: dist?.available ? dist.value : null,
      distanceFrom52wHighAvailable: Boolean(dist?.available && dist.value !== null),
      catalystWatch: scored.events.some((event) => {
        const c = event.classification;
        return c === "Positive catalyst" || c === "Negative" || c === "Uncertain";
      }),
      catalystLabel: (() => {
        const hit = scored.events.find(
          (event) =>
            event.classification === "Positive catalyst" ||
            event.classification === "Negative" ||
            event.classification === "Uncertain",
        );
        return hit ? `${hit.classification}: ${hit.headline}` : null;
      })(),
      hasEvents: scored.events.length > 0,
      eventCount: scored.events.length,
      result: scored.result,
    };
}

export function toWorkspaceRow(row: OpportunityRow): WorkspaceRow {
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    price: row.price,
    buyScore: row.buyScore,
    researchScore: row.researchScore,
    valuationScore: row.valuationScore,
    qualityScore: row.qualityScore,
    confidence: row.confidence,
    needsVerification: row.needsVerification,
    freshness: row.freshness,
    coverage: row.coreCoverageLabel,
    priceDate: row.lastTradeDate,
    pn17: row.pn17,
    watchlistReason: row.watchlistReason ?? null,
    prices: loadSavedPrices(row.ticker, 30),
  };
}

export function clearOpportunityScanCache() {
  scanCache = null;
}
