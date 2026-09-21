import { loadScoreHistory, loadWatchlist } from "@/db/queries";
import { latestAnnualPeriod } from "@/lib/snapshot-dates";
import type { MetricValue } from "@/metrics/types";
import {
  categoryScore,
  liveCoverage,
  mainConcernLabel,
  type OpportunityRow,
} from "@/opportunities/lists";
import { scoreTicker } from "@/scoring/run-ticker";

function metric(metrics: MetricValue[], id: string): MetricValue | undefined {
  return metrics.find((m) => m.id === id);
}

const SCAN_CACHE_MS = 15_000;
let scanCache: { at: number; rows: OpportunityRow[] } | null = null;

export function scanWatchlist(): OpportunityRow[] {
  if (scanCache && Date.now() - scanCache.at < SCAN_CACHE_MS) {
    return scanCache.rows;
  }
  const universe = loadWatchlist();
  const rows: OpportunityRow[] = [];
  for (const item of universe) {
    const scored = scoreTicker(item.ticker, false, { attachValuationContext: false });
    if (!scored) continue;
    const lastClose = metric(scored.metrics, "last_close");
    const lastTrade = metric(scored.metrics, "last_trade_date");
    const dist = metric(scored.metrics, "distance_from_52w_high");
    const history = loadScoreHistory(scored.instrument.id, 8);
    rows.push({
      ticker: scored.instrument.ticker,
      name: scored.instrument.name,
      instrumentType: scored.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
      pn17: scored.instrument.pn17,
      shariahCompliant: scored.instrument.shariahCompliant ?? null,
      listingBoard: scored.instrument.listingBoard ?? null,
      marketCap: metric(scored.metrics, "market_cap")?.available
        ? (metric(scored.metrics, "market_cap")?.value ?? null)
        : null,
      price: lastClose?.available ? lastClose.value : null,
      lastTradeDate: lastTrade?.period ?? item.lastTradeDate,
      fundamentalsPeriod: latestAnnualPeriod(scored.periods),
      researchScore: scored.result.researchScore,
      valuationScore: scored.result.valuationScore,
      qualityScore: categoryScore(scored.result, "quality"),
      growthScore: categoryScore(scored.result, "growth"),
      healthScore: categoryScore(scored.result, "financial_health"),
      coverage: liveCoverage(scored.result),
      freshness: scored.result.dataCoverage.freshness,
      confidence: scored.result.dataConfidence.level,
      needsVerification: scored.result.dataConfidence.needsVerification,
      coreCoverageLabel: `${Math.round(scored.result.dataCoverage.coverageRatio * 100)}% (${scored.result.dataCoverage.available}/${scored.result.dataCoverage.expected})`,
      mainConcern: mainConcernLabel(scored.result),
      distanceFrom52wHigh: dist?.available ? dist.value : null,
      distanceFrom52wHighAvailable: Boolean(dist?.available && dist.value !== null),
      persistedResearchScores: history.map((row) => row.researchScore),
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
      result: scored.result,
    });
  }
  scanCache = { at: Date.now(), rows };
  return rows;
}
