import { getSqlite } from "@/db/client";
import { loadLatestMarketScan } from "@/market/scan";
import type { ScoreResult } from "@/scoring/types";
import { loadScoringConfig, type ScoringConfig } from "@/config/load-scoring";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import type { MetricValue } from "@/metrics/types";

export type PickCandidate = { ticker: string; name: string; lastTrade: string | null; marketCap: number | null; lastClose: number | null; result: ScoreResult };
export type TopPicksOptions = { qualityTilt?: boolean; lotBudget?: number };

export function parseTopPicksOptions(params: Record<string, string | string[] | undefined>): TopPicksOptions {
  const budget = typeof params.lotBudget === "string" && params.lotBudget.trim() ? Number(params.lotBudget) : NaN;
  return { qualityTilt: params.qualityTilt === "on", lotBudget: Number.isFinite(budget) && budget > 0 ? budget : undefined };
}

export function topPickScore(row: PickCandidate, options: TopPicksOptions, settings: ScoringConfig["top_picks"]): number | null {
  if (!options.qualityTilt || row.result.researchProfile !== "GENERAL") return row.result.researchScore;
  const weights: Record<string, number> = settings.quality_tilt_weights;
  const live = row.result.categories.filter((category) => category.score !== null && Number.isFinite(category.score) && weights[category.id] > 0);
  const weight = live.reduce((sum, category) => sum + weights[category.id], 0);
  return weight ? live.reduce((sum, category) => sum + category.score! * weights[category.id], 0) / weight : null;
}

const descriptions: Record<string, string> = {
  earnings_yield: "Cheap vs peers: earnings yield", book_to_price: "Cheap vs peers: book value relative to price",
  ebit_ev: "Operating earnings relative to enterprise value", dividend_yield: "Dividend yield", distribution_yield: "Distribution yield",
  nav_to_price: "Asset backing relative to price", roe: "Return on shareholders' equity", gross_profitability: "Gross profit relative to assets",
  piotroski: "Financial strength checks", momentum_12_1: "12–1 month price momentum", volatility_252: "Lower price volatility",
  revenue_cagr: "Multi-year revenue growth", eps_cagr: "Multi-year earnings growth", dpu_cagr: "Multi-year distribution growth",
};

export function pickReasons(result: ScoreResult): string[] {
  return result.categories.flatMap((category) => category.factors)
    .filter((factor) => factor.available && factor.percentile && factor.score !== null && (!(factor.metricId === "earnings_yield" || factor.metricId === "ebit_ev") || (factor.value ?? 0) > 0))
    .sort((a, b) => b.score! - a.score! || a.id.localeCompare(b.id)).slice(0, 3)
    .map((factor) => `${factor.score! >= 50 ? descriptions[factor.metricId] ?? factor.label : factor.label}: blended peer percentile ${factor.score!.toFixed(0)} (top ${Math.max(1, Math.ceil(100 - factor.score!))}%).`);
}

export function selectTopPicks(rows: PickCandidate[], limit = 15, options: TopPicksOptions = {}, settings = loadScoringConfig().top_picks) {
  const budget = options.lotBudget !== undefined && Number.isFinite(options.lotBudget) && options.lotBudget > 0 ? options.lotBudget : null;
  return rows.filter((row) => row.result.methodology === "cross-sectional-v2" && row.result.eligibility?.eligible === true && row.result.researchScore !== null && Number.isFinite(row.result.researchScore))
    .filter((row) => {
      const tradedValue = row.result.eligibility?.medianTradedValue;
      return row.marketCap !== null && Number.isFinite(row.marketCap) && row.marketCap >= settings.min_market_cap && tradedValue != null && Number.isFinite(tradedValue) && tradedValue >= settings.min_median_traded_value;
    })
    .filter((row) => budget === null || (row.lastClose !== null && Number.isFinite(row.lastClose) && row.lastClose > 0 && Math.round(row.lastClose * 100 * 100) <= Math.round(budget * 100)))
    .map((row) => ({ ...row, selectionScore: topPickScore(row, options, settings), qualityTilted: options.qualityTilt === true && row.result.researchProfile === "GENERAL" }))
    .filter((row) => row.selectionScore !== null && Number.isFinite(row.selectionScore))
    .sort((a, b) => b.selectionScore! - a.selectionScore! || a.ticker.localeCompare(b.ticker)).slice(0, limit);
}

export function exclusionCounts(rows: Record<string, unknown>[]) {
  const counts = new Map<string, number>();
  for (const row of rows.filter((r) => r.eligible !== true)) {
    const categories = new Set((Array.isArray(row.exclusionReasons) ? row.exclusionReasons.map(String) : ["Eligibility not verified"]).map((reason) => /PN17|warning/i.test(reason) ? "PN17 / warning flag" : /traded value|liquidity|volume/i.test(reason) ? "Low or unverified liquidity" : /price days/i.test(reason) ? "Insufficient price history" : /coverage/i.test(reason) ? "Low factor coverage" : "Eligibility not verified"));
    for (const category of categories) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function loadTopPicksInputs() {
  const { summary, rows } = loadLatestMarketScan();
  if (!summary) return { summary: null, candidates: [], excluded: 0, exclusions: [] as [string, number][] };
  const published = new Map(rows.map((row) => [String(row.ticker), row]));
  const stored = getSqlite().prepare("SELECT i.ticker, s.evidence_json AS evidence FROM score_runs s JOIN instruments i ON i.id = s.instrument_id WHERE s.as_of = ? ORDER BY s.id DESC").all(summary.asOf) as { ticker: string; evidence: string }[];
  const candidates = new Map<string, PickCandidate>();
  for (const row of stored) {
    if (candidates.has(row.ticker)) continue;
    try {
      const evidence = JSON.parse(row.evidence);
      const result = evidence.storedResult as ScoreResult | undefined;
      const market = published.get(row.ticker);
      if (!result || result.asOf !== summary.asOf || !market || market.researchScore !== result.researchScore || market.eligible !== true) continue;
      result.dataCoverage.notApplicable ??= 0;
      const metrics: MetricValue[] = Array.isArray(evidence.scoredMetrics) ? evidence.scoredMetrics : [];
      const metric = (id: string) => {
        const item = metrics.find((value) => value.id === id);
        return item?.available && item.value !== null && Number.isFinite(item.value) ? item.value : null;
      };
      candidates.set(row.ticker, { ticker: row.ticker, name: String(market.name), lastTrade: typeof market.lastTrade === "string" ? market.lastTrade : null, marketCap: metric("market_cap"), lastClose: metric("last_close"), result });
    } catch { /* Unreadable evidence is not a recommendation. */ }
  }
  return { summary, candidates: [...candidates.values()], excluded: rows.filter((row) => row.eligible !== true).length, exclusions: exclusionCounts(rows) };
}

let snapshotTopPicksInputs: ReturnType<typeof loadTopPicksInputs> | undefined;

export function loadTopPicks(options: TopPicksOptions = {}) {
  const settings = loadScoringConfig().top_picks;
  const { summary, candidates, excluded, exclusions } = isSnapshotReadOnly()
    ? (snapshotTopPicksInputs ??= loadTopPicksInputs())
    : loadTopPicksInputs();
  return { summary, picks: selectTopPicks(candidates, 15, options, settings), excluded, exclusions, settings };
}
