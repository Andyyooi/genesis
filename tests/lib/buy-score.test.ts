import { describe, expect, it } from "vitest";
import { buyScore, buyScoreVerdict, formatBuyRank, researchRank } from "@/lib/buy-score";

const pool = Array.from({ length: 101 }, (_, i) => i);

describe("buy score", () => {
  it("ranks the research score against all stocks", () => {
    expect(researchRank(100, pool)).toBe(100);
    expect(researchRank(0, pool)).toBe(0);
    expect(researchRank(50, pool)).toBe(50);
  });

  it("gives a top research score a 90+ Buy score when the safety checks pass", () => {
    const score = buyScore({ researchScore: 95, allResearchScores: pool, eligible: true, needsVerification: false });
    expect(score).toEqual({ available: true, score: 95, capped: false });
    expect(buyScoreVerdict(score).label).toBe("Top 10% of stocks");
  });

  it("holds the score below 70 when a safety check fails", () => {
    expect(buyScore({ researchScore: 95, allResearchScores: pool, eligible: false, needsVerification: false })).toEqual({ available: true, score: 69, capped: true });
    expect(buyScore({ researchScore: 95, allResearchScores: pool, eligible: true, needsVerification: true })).toMatchObject({ score: 69, capped: true });
    expect(buyScore({ researchScore: 40, allResearchScores: pool, eligible: false, needsVerification: true })).toMatchObject({ score: 40, capped: false });
  });

  it("has no Buy score without a research score", () => {
    expect(buyScore({ researchScore: null, allResearchScores: pool, eligible: true, needsVerification: false }).available).toBe(false);
  });

  it("reads as a rank, not a score", () => {
    expect(formatBuyRank(96)).toBe("Top 4%");
    expect(formatBuyRank(100)).toBe("Top 1%");
    expect(formatBuyRank(69)).toBe("Top 31%");
    expect(formatBuyRank(50)).toBe("Top 50%");
    expect(formatBuyRank(30)).toBe("Bottom 30%");
    expect(formatBuyRank(0)).toBe("Bottom 1%");
    expect(formatBuyRank(null)).toBe("—");
  });
});
