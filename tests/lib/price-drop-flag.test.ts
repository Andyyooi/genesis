import { describe, expect, it } from "vitest";
import {
  goodCompanyPriceDown,
  latestResultsComparison,
  recentPriceDrop,
  strongAccountScores,
} from "@/lib/price-drop-flag";
import type { ScoreResult } from "@/scoring/types";

function bars(closes: number[]) {
  return closes.map((close, i) => ({ barDate: `2026-11-${String(30 - (i % 30)).padStart(2, "0")}`, close, source: "yahoo" }));
}

/** "off" = the profile does not score this category (e.g. bank financial health). */
function result(scores: Record<string, number | null | "off">): ScoreResult {
  return {
    categories: Object.entries(scores).map(([id, score]) => ({
      id,
      score: score === "off" ? null : score,
      inThisRun: typeof score === "number",
      configuredWeight: score === "off" ? 0 : 20,
      totalFactorWeights: score === "off" ? 0 : 100,
    })),
  } as unknown as ScoreResult;
}

function annual(periodEnd: string, pat: number | null, revenue: number | null = null) {
  return { periodEnd, statementType: "annual", lineItemsJson: JSON.stringify({ pat, revenue }) };
}

describe("recentPriceDrop", () => {
  it("measures the latest close against the highest close in the window", () => {
    const drop = recentPriceDrop(bars([0.8, ...Array(30).fill(0.9), 1.0, ...Array(20).fill(0.95)]));
    expect(drop?.drop).toBeCloseTo(0.2);
    expect(drop?.highClose).toBe(1.0);
  });

  it("needs enough price history", () => {
    expect(recentPriceDrop(bars([1, 2, 3]))).toBeNull();
  });
});

describe("strongAccountScores", () => {
  it("requires every available accounts score to be strong", () => {
    expect(strongAccountScores(result({ quality: 72, financial_health: 65 }))).toHaveLength(2);
    expect(strongAccountScores(result({ quality: 72, financial_health: 40 }))).toBeNull();
    expect(strongAccountScores(result({ quality: 72, financial_health: "off" }))).toHaveLength(1);
    expect(strongAccountScores(result({ quality: 80, financial_health: null }))).toBeNull();
    expect(strongAccountScores(result({ momentum: 90 }))).toBeNull();
  });
});

describe("latestResultsComparison", () => {
  it("says when the latest year is weaker", () => {
    const r = latestResultsComparison([annual("2026-06-30", 18.9e6, 208e6), annual("2025-06-30", 26.3e6, 324e6)]);
    expect(r?.tone).toBe("weaker");
    expect(r?.text).toBe("Latest full-year results (year to Jun 2026) weaker than last year: profit down 28% on the year before; sales down 36%.");
  });

  it("handles losses and missing sales", () => {
    expect(latestResultsComparison([annual("2026-06-30", 5e6, 0), annual("2025-06-30", -2e6)])?.text).toBe(
      "Latest full-year results (year to Jun 2026) stronger than last year: back to a profit after a loss the year before.",
    );
    expect(latestResultsComparison([annual("2026-06-30", -1e6), annual("2025-06-30", 3e6)])?.tone).toBe("weaker");
  });

  it("skips gaps that are not one year apart or missing profit", () => {
    expect(latestResultsComparison([annual("2026-06-30", 5e6), annual("2024-06-30", 4e6)])).toBeNull();
    expect(latestResultsComparison([annual("2026-06-30", null), annual("2025-06-30", 4e6)])).toBeNull();
  });

  it("ignores forecasts", () => {
    const forecast = { ...annual("2027-06-30", 1e6), actualOrEstimate: "estimate" };
    expect(latestResultsComparison([forecast, annual("2026-06-30", 12e6), annual("2025-06-30", 10e6)])?.text).toContain("year to Jun 2026");
  });
});

describe("goodCompanyPriceDown", () => {
  const fallen = bars([0.7, ...Array(40).fill(1.0)]);
  const periods = [annual("2026-06-30", 8e6), annual("2025-06-30", 10e6)];

  it("flags a sharp fall while accounts scores stay strong", () => {
    const flag = goodCompanyPriceDown({ result: result({ quality: 80, financial_health: 70 }), bars: fallen, periods });
    expect(flag?.priceDrop.drop).toBeCloseTo(0.3);
    expect(flag?.results?.tone).toBe("weaker");
  });

  it("does not flag weak scores, small falls or PN17 names", () => {
    expect(goodCompanyPriceDown({ result: result({ quality: 50 }), bars: fallen, periods })).toBeNull();
    expect(goodCompanyPriceDown({ result: result({ quality: 80 }), bars: bars([0.9, ...Array(40).fill(1.0)]), periods })).toBeNull();
    expect(goodCompanyPriceDown({ result: result({ quality: 80 }), bars: fallen, periods, pn17: true })).toBeNull();
  });
});

describe("latestResultsComparison for banks", () => {
  it("can leave sales out", () => {
    expect(latestResultsComparison([annual("2026-06-30", 10e6, 50e6), annual("2025-06-30", 10e6, 100e6)], { includeSales: false })?.text).toBe(
      "Latest full-year results (year to Jun 2026) similar to last year: profit about the same as the year before.",
    );
  });
});
