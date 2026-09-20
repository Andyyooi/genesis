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

export function scanWatchlist(): OpportunityRow[] {
  const universe = loadWatchlist();
  const rows: OpportunityRow[] = [];
  for (const item of universe) {
    const scored = scoreTicker(item.ticker, false);
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
      price: lastClose?.available ? lastClose.value : null,
      lastTradeDate: lastTrade?.period ?? item.lastTradeDate,
      fundamentalsPeriod: latestAnnualPeriod(scored.periods),
      researchScore: scored.result.researchScore,
      valuationScore: scored.result.valuationScore,
      qualityScore: categoryScore(scored.result, "quality"),
      growthScore: categoryScore(scored.result, "growth"),
      healthScore: categoryScore(scored.result, "financial_health"),
      coverage: liveCoverage(scored.result),
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
  return rows;
}
