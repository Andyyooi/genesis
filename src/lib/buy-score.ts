import type { FairRangeHeadline } from "@/lib/fair-range";

/** How much the research comparison counts; the price against the fair range makes up the rest. */
export const BUY_SCORE_RESEARCH_WEIGHT = 0.6;
/** Stocks with missing/old key figures, PN17 or listing warnings never show a high Buy score. */
export const BUY_SCORE_CAUTION_CAP = 69;

export type BuyScore =
  | {
      available: true;
      score: number;
      /** Share of scored stocks with a lower research score, 0-100. */
      researchRank: number;
      /** 100 at or below the fair range, 40 at its top, 0 at 1.5x its top. */
      priceScore: number;
      capped: boolean;
    }
  | { available: false; reason: string };

/** Percent of the other research scores that are below this one (ties count half). */
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

export function priceScore(price: number, low: number, high: number): number {
  if (price <= low) return 100;
  if (high <= low) return price <= high ? 100 : 0;
  if (price <= high) return 100 - (60 * (price - low)) / (high - low);
  return Math.max(0, 40 - (40 * (price - high)) / (0.5 * high));
}

export function buyScore(args: {
  researchScore: number | null;
  allResearchScores: readonly number[];
  fairRange: FairRangeHeadline;
  caution: boolean;
}): BuyScore {
  const { researchScore, fairRange } = args;
  if (researchScore === null || !Number.isFinite(researchScore)) {
    return { available: false, reason: "No research score, so there is no Buy score." };
  }
  if (!fairRange.available) {
    return { available: false, reason: "No fair price range, so there is no Buy score." };
  }
  if (fairRange.price === null) {
    return { available: false, reason: "No recent price, so there is no Buy score." };
  }
  const rank = researchRank(researchScore, args.allResearchScores);
  const price = priceScore(fairRange.price, fairRange.low, fairRange.high);
  const raw = BUY_SCORE_RESEARCH_WEIGHT * rank + (1 - BUY_SCORE_RESEARCH_WEIGHT) * price;
  const capped = args.caution && raw > BUY_SCORE_CAUTION_CAP;
  return {
    available: true,
    score: Math.round(capped ? BUY_SCORE_CAUTION_CAP : raw),
    researchRank: rank,
    priceScore: price,
    capped,
  };
}

export type BuyScoreBand = "GREAT" | "GOOD" | "OK" | "WEAK";

export function buyScoreBand(score: number): BuyScoreBand {
  if (score >= 90) return "GREAT";
  if (score >= 75) return "GOOD";
  if (score >= 55) return "OK";
  return "WEAK";
}
