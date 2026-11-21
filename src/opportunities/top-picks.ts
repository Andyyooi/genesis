import { getSqlite } from "@/db/client";
import { loadLatestMarketScan } from "@/market/scan";
import type { ScoreResult } from "@/scoring/types";

export type PickCandidate = { ticker: string; name: string; lastTrade: string | null; result: ScoreResult };

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

export function selectTopPicks(rows: PickCandidate[], limit = 15) {
  return rows.filter((row) => row.result.methodology === "cross-sectional-v2" && row.result.eligibility?.eligible === true && row.result.researchScore !== null && Number.isFinite(row.result.researchScore))
    .sort((a, b) => b.result.researchScore! - a.result.researchScore! || a.ticker.localeCompare(b.ticker)).slice(0, limit);
}

export function exclusionCounts(rows: Record<string, unknown>[]) {
  const counts = new Map<string, number>();
  for (const row of rows.filter((r) => r.eligible !== true)) {
    const categories = new Set((Array.isArray(row.exclusionReasons) ? row.exclusionReasons.map(String) : ["Eligibility not verified"]).map((reason) => /PN17|warning/i.test(reason) ? "PN17 / warning flag" : /traded value|liquidity|volume/i.test(reason) ? "Low or unverified liquidity" : /price days/i.test(reason) ? "Insufficient price history" : /coverage/i.test(reason) ? "Low factor coverage" : "Eligibility not verified"));
    for (const category of categories) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

export function loadTopPicks() {
  const { summary, rows } = loadLatestMarketScan();
  if (!summary) return { summary: null, picks: [], excluded: 0, exclusions: [] as [string, number][] };
  const published = new Map(rows.map((row) => [String(row.ticker), row]));
  const stored = getSqlite().prepare("SELECT i.ticker, s.evidence_json AS evidence FROM score_runs s JOIN instruments i ON i.id = s.instrument_id WHERE s.as_of = ? ORDER BY s.id DESC").all(summary.asOf) as { ticker: string; evidence: string }[];
  const candidates = new Map<string, PickCandidate>();
  for (const row of stored) {
    if (candidates.has(row.ticker)) continue;
    try {
      const result = JSON.parse(row.evidence).storedResult as ScoreResult | undefined;
      const market = published.get(row.ticker);
      if (!result || result.asOf !== summary.asOf || !market || market.researchScore !== result.researchScore || market.eligible !== true) continue;
      candidates.set(row.ticker, { ticker: row.ticker, name: String(market.name), lastTrade: typeof market.lastTrade === "string" ? market.lastTrade : null, result });
    } catch { /* Unreadable evidence is not a recommendation. */ }
  }
  return { summary, picks: selectTopPicks([...candidates.values()]), excluded: rows.filter((row) => row.eligible !== true).length, exclusions: exclusionCounts(rows) };
}
