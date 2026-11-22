import { CATEGORY_LABELS } from "@/lib/research-copy";
import type { ScoreResult } from "@/scoring/types";

/** About three months of trading days. */
export const PRICE_DROP_WINDOW_BARS = 63;
/** Fall from the recent high that counts as sharp. */
export const SHARP_DROP = 0.2;
/** Category percentile that counts as strong. */
export const STRONG_SCORE = 60;

type Bar = { barDate: string; close: number | null; source?: string };
type Period = { periodEnd: string; statementType: string; lineItemsJson: string | null };

export type PriceDrop = {
  drop: number;
  highClose: number;
  highDate: string;
  lastClose: number;
  lastDate: string;
};

export type StrongScore = { id: string; label: string; score: number };

export type ResultsComparison = {
  tone: "weaker" | "stronger" | "similar";
  text: string;
};

export type GoodCompanyPriceDown = {
  priceDrop: PriceDrop;
  scores: StrongScore[];
  results: ResultsComparison | null;
};

/** Latest close against the highest close in the recent window. Bars are newest first. */
export function recentPriceDrop(bars: Bar[], windowBars = PRICE_DROP_WINDOW_BARS): PriceDrop | null {
  const yahoo = bars.some((b) => b.source === "yahoo");
  const usable = bars
    .filter((b) => (!yahoo || b.source === "yahoo") && b.close !== null && Number.isFinite(b.close) && b.close > 0)
    .slice(0, windowBars);
  if (usable.length < 20) return null;
  const last = usable[0];
  let high = last;
  for (const bar of usable) if ((bar.close as number) > (high.close as number)) high = bar;
  return {
    drop: 1 - (last.close as number) / (high.close as number),
    highClose: high.close as number,
    highDate: high.barDate,
    lastClose: last.close as number,
    lastDate: last.barDate,
  };
}

/** Business quality and financial health, where this profile scores them. Each must be scored and strong. */
export function strongAccountScores(result: ScoreResult, threshold = STRONG_SCORE): StrongScore[] | null {
  const scored = ["quality", "financial_health"]
    .map((id) => result.categories.find((c) => c.id === id))
    .filter((c) => c !== undefined && c.configuredWeight > 0 && c.totalFactorWeights > 0);
  if (scored.length === 0) return null;
  const scores: StrongScore[] = [];
  for (const c of scored) {
    if (!c!.inThisRun || c!.score === null || !Number.isFinite(c!.score) || c!.score < threshold) return null;
    scores.push({ id: c!.id, label: CATEGORY_LABELS[c!.id] ?? c!.id, score: c!.score });
  }
  return scores;
}

function lineItem(period: Period, key: "pat" | "revenue"): number | null {
  try {
    const value = JSON.parse(period.lineItemsJson ?? "{}")?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function pct(change: number): string {
  return `${Math.round(Math.abs(change) * 100)}%`;
}

function yearEnd(periodEnd: string): string {
  const d = new Date(`${periodEnd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return periodEnd;
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Plain comparison of the latest full-year profit (and sales) with the year before. */
/** Bank "revenue" mixes income definitions across sources, so callers can leave sales out. */
export function latestResultsComparison(periods: Period[], opts: { includeSales?: boolean } = {}): ResultsComparison | null {
  const byEnd = new Map<string, Period>();
  for (const p of periods) {
    if (p.statementType !== "annual") continue;
    const existing = byEnd.get(p.periodEnd);
    if (!existing || (lineItem(existing, "pat") === null && lineItem(p, "pat") !== null)) byEnd.set(p.periodEnd, p);
  }
  const annuals = [...byEnd.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  if (annuals.length < 2) return null;
  const [latest, previous] = annuals;
  const gapDays = (Date.parse(latest.periodEnd) - Date.parse(previous.periodEnd)) / 86_400_000;
  if (!(gapDays > 300 && gapDays < 430)) return null;
  const pat = lineItem(latest, "pat");
  const prevPat = lineItem(previous, "pat");
  if (pat === null || prevPat === null) return null;

  let tone: ResultsComparison["tone"];
  let profit: string;
  if (pat > 0 && prevPat > 0) {
    const change = pat / prevPat - 1;
    tone = change <= -0.05 ? "weaker" : change >= 0.05 ? "stronger" : "similar";
    profit = tone === "similar" ? "profit about the same as the year before" : `profit ${change < 0 ? "down" : "up"} ${pct(change)} on the year before`;
  } else if (pat > 0) {
    tone = "stronger";
    profit = "back to a profit after a loss the year before";
  } else if (prevPat > 0) {
    tone = "weaker";
    profit = "a loss, after a profit the year before";
  } else {
    tone = pat < prevPat ? "weaker" : "stronger";
    profit = `a loss again, ${pat < prevPat ? "bigger" : "smaller"} than the year before`;
  }

  const revenue = lineItem(latest, "revenue");
  const prevRevenue = lineItem(previous, "revenue");
  let sales = "";
  if (opts.includeSales !== false && revenue !== null && prevRevenue !== null && revenue > 0 && prevRevenue > 0) {
    const change = revenue / prevRevenue - 1;
    sales = Math.abs(change) < 0.05 ? "; sales about the same" : `; sales ${change < 0 ? "down" : "up"} ${pct(change)}`;
  }

  const headline = tone === "weaker" ? "weaker than last year" : tone === "stronger" ? "stronger than last year" : "similar to last year";
  return {
    tone,
    text: `Latest full-year results (year to ${yearEnd(latest.periodEnd)}) ${headline}: ${profit}${sales}.`,
  };
}

/** A sharp recent fall while the accounts-based scores still rank strongly. A prompt to look closer, not advice. */
export function goodCompanyPriceDown(args: {
  result: ScoreResult;
  bars: Bar[];
  periods: Period[];
  pn17?: boolean;
  includeSales?: boolean;
}): GoodCompanyPriceDown | null {
  if (args.pn17) return null;
  const priceDrop = recentPriceDrop(args.bars);
  if (!priceDrop || priceDrop.drop < SHARP_DROP) return null;
  const scores = strongAccountScores(args.result);
  if (!scores) return null;
  return { priceDrop, scores, results: latestResultsComparison(args.periods, { includeSales: args.includeSales }) };
}
