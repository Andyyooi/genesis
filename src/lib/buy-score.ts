/** Stocks that fail the safety checks (too small or thinly traded, PN17, listing warning) or whose key figures are missing or old never show a high Buy score. */
export const BUY_SCORE_CAUTION_CAP = 69;

export type BuyScore =
  | { available: true; score: number; capped: boolean }
  | { available: false; reason: string };

/** Percent of the other research scores that are below this one (ties count half), 0-100. */
export function researchRank(score: number, allScores: readonly number[]): number {
  const others = allScores.filter((value) => Number.isFinite(value));
  if (others.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const value of others) {
    if (value < score) below += 1;
    else if (value === score) equal += 1;
  }
  const rank = (below + Math.max(0, equal - 1) / 2) / (others.length - 1);
  return Math.max(0, Math.min(100, rank * 100));
}

/**
 * Buy score: where the research score ranks among all scored stocks, capped
 * when the safety checks fail. The fair range is shown beside it as an entry
 * price guide and does not change the score: in the backtest, stocks below
 * their fair range did not do better than stocks above it.
 */
export function buyScore(args: {
  researchScore: number | null;
  allResearchScores: readonly number[];
  eligible: boolean;
  needsVerification: boolean;
}): BuyScore {
  const { researchScore } = args;
  if (researchScore === null || !Number.isFinite(researchScore)) {
    return { available: false, reason: "No research score, so there is no Buy score." };
  }
  const raw = researchRank(researchScore, args.allResearchScores);
  const capped = (!args.eligible || args.needsVerification) && raw > BUY_SCORE_CAUTION_CAP;
  return { available: true, score: Math.round(capped ? BUY_SCORE_CAUTION_CAP : raw), capped };
}

export function buyScoreValue(score: BuyScore): number | null {
  return score.available ? score.score : null;
}

export function buyScoreVerdict(score: BuyScore): { label: string; tone: string; why: string } {
  if (!score.available) return { label: "No Buy score", tone: "UNKNOWN", why: score.reason };
  if (score.capped) return {
    label: "Held back", tone: "LOW",
    why: "The research compares well, but the stock fails a safety check (too small or thinly traded, a warning flag, or missing or old figures), so the Buy score is held below 70.",
  };
  if (score.score >= 90) return { label: "Top 10% of stocks", tone: "HIGH", why: "Its research compares better than at least 9 in 10 stocks and it passes the safety checks." };
  if (score.score >= 75) return { label: "Better than most", tone: "HIGH", why: "Its research compares better than about three-quarters of stocks and it passes the safety checks." };
  if (score.score >= 50) return { label: "Middle of the pack", tone: "MEDIUM", why: "Its research is around the middle compared with other stocks." };
  return { label: "Weaker than most", tone: "VERY_LOW", why: "Most other stocks compare better on the research checks." };
}

export const BUY_SCORE_BACKTEST_NOTE =
  "Backtest (Jul 2025 to Jul 2026, mostly a falling market): stocks scoring 90+ made money 50% of the time after 3 months, 52% after 6 months and 57% after 12 months, against about 46% for any stock that passed the safety checks and 39-40% for all stocks. It tilts the odds a little; it does not make a gain likely. Check the company and aim to buy inside or below the fair range.";
