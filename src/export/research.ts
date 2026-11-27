import { loadListFairRanges } from "@/fair-value/load-list-ranges";
import { buyScoreValue } from "@/lib/buy-score";
import { fairRangeGap } from "@/lib/fair-range-summary";
import { loadTopPicks } from "@/opportunities/top-picks";
import { publishedBuyScore } from "@/scoring/published-research-scores";

export function loadResearchExport() {
  const { summary, picks, priceDate } = loadTopPicks();
  const ranges = loadListFairRanges(picks.map(({ ticker }) => ticker));

  return {
    schema: "bursa-research.research-export.v1",
    disclaimer: "Research only, not a buy or sell instruction.",
    asOfDate: priceDate,
    researchAsOf: summary?.asOf ?? null,
    topPicks: picks.map(({ ticker, name, lastClose, result }) => {
      const range = ranges[ticker];
      const gap = fairRangeGap(range);
      return {
        ticker,
        name,
        lastClose,
        researchScore: result.researchScore,
        buyRank: buyScoreValue(publishedBuyScore({
          researchScore: result.researchScore,
          eligible: result.eligibility?.eligible === true,
          needsVerification: result.dataConfidence.needsVerification,
        })),
        fairRange: range?.available ? { low: range.low, high: range.high } : null,
        pricePosition: gap && range?.available ? { ...gap, price: range.price } : null,
      };
    }),
    holdings: null,
  };
}
