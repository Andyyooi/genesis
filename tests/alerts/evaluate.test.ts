import { loadScoringConfig } from "@/config/load-scoring";
import { describe, expect, it } from "vitest";
import { evaluateAlertDrafts, isEarningsHeadline, type AlertInputs } from "@/alerts/evaluate";
import type { ScoreResult } from "@/scoring/types";
import { emptyValuationContext } from "@/scoring/valuation-context";

const config = loadScoringConfig();

function result(over: Partial<ScoreResult> = {}): ScoreResult {
  return {
    asOf: "2026-09-20T00:00:00.000Z",
    configHash: "x",
    profile: "default",
    researchProfile: "GENERAL",
    researchProfileReason: "test fixture",
    researchScore: 71,
    valuationScore: 84,
    categories: [
      {
        id: "financial_health",
        configuredWeight: 15,
        liveWeight: 0.2,
        score: 40,
        coverage: 1,
        availableFactorWeights: 100,
        totalFactorWeights: 100,
        inThisRun: true,
        warning: null,
        factors: [],
      },
    ],
    concerns: [],
    notes: ["News is in this live run."],
    dataCoverage: {
      expected: 9,
      available: 7,
      unavailable: 2,
      coverageRatio: 7 / 9,
      freshCount: 7,
      agingCount: 0,
      staleCount: 0,
      veryStaleCount: 0,
      unknownCount: 0,
      freshness: "AGING",
      periodEnd: "2024-12-31",
      availableAt: null,
      ageMonths: 21,
    },
    dataConfidence: { level: "MEDIUM", reasons: [], needsVerification: false },
    valuationContext: emptyValuationContext("test fixture"),
    ...over,
  };
}

function input(over: Partial<AlertInputs> = {}): AlertInputs {
  const scored = over.result ?? result();
  return {
    ticker: "MAYBANK",
    name: "Malayan Banking Berhad",
    result: scored,
    events: [],
    lastClose: 10,
    lastCloseDate: "2026-09-18",
    close1dAgo: 10,
    close5dAgo: 10,
    valuationScore: 84,
    qualityScore: 46,
    persistedResearchScores: [71],
    distanceFrom52wHigh: 0.16,
    distanceFrom52wHighAvailable: true,
    catalystWatch: true,
    fundamentalsPeriod: "2024-12-31",
    demoPriorScore: null,
    ...over,
  };
}

describe("alert rules", () => {
  it("explains a Research Score jump without BUY/SELL", () => {
    const drafts = evaluateAlertDrafts(config, input({ demoPriorScore: 64, result: result({ researchScore: 71 }) }), {
      lastResearchScore: 64,
      lastHealthScore: 40,
      lastConcernIds: [],
      lastListIds: [],
      lastEventKeys: [],
      lastClose: 10,
      lastCloseDate: "2026-09-17",
    });
    const hit = drafts.find((d) => d.ruleId === "research_score_up");
    expect(hit?.why).toMatch(/64\.0 → 71\.0/);
    expect(hit?.why).toMatch(/FY/);
    expect(hit?.why).not.toMatch(/\bBUY\b/);
    expect(hit?.why).not.toMatch(/\bSELL\b/);
  });

  it("flags new concerns and earnings headlines", () => {
    const drafts = evaluateAlertDrafts(
      config,
      input({
        result: result({
          concerns: [
            {
              id: "falling_revenue",
              label: "Falling revenue",
              message: "Revenue CAGR is negative.",
              metricId: "revenue_cagr",
              value: -0.1,
              period: "2020-12-31 → 2024-12-31",
            },
          ],
        }),
        events: [
          {
            occurredAt: "2024-11-26",
            availableAt: "2024-11-26",
            source: "Maybank IR",
            sourceUrl: "https://www.maybank.com/en/news/2024/11/26.page",
            headline: "Maybank’s 9M FY24 net profit rises 8.5% to RM7.56b",
            excerpt: null,
            classification: "Positive catalyst",
            relevanceNote: "rule",
          },
        ],
      }),
      {
        lastResearchScore: 71,
        lastHealthScore: 40,
        lastConcernIds: [],
        lastListIds: ["undervalued", "catalyst"],
        lastEventKeys: [],
        lastClose: 10,
        lastCloseDate: "2026-09-18",
      },
    );
    expect(drafts.some((d) => d.ruleId === "new_concern")).toBe(true);
    expect(drafts.some((d) => d.ruleId === "earnings_announcement")).toBe(true);
    expect(isEarningsHeadline("Notice of annual general meeting")).toBe(false);
  });

  it("skips health deterioration when health is unavailable", () => {
    const drafts = evaluateAlertDrafts(
      config,
      input({
        result: result({
          categories: [
            {
              id: "financial_health",
              configuredWeight: 15,
              liveWeight: null,
              score: null,
              coverage: 0,
              availableFactorWeights: 0,
              totalFactorWeights: 100,
              inThisRun: false,
              warning: "omitted",
              factors: [],
            },
          ],
        }),
      }),
      {
        lastResearchScore: 71,
        lastHealthScore: null,
        lastConcernIds: [],
        lastListIds: ["undervalued"],
        lastEventKeys: [],
        lastClose: 10,
        lastCloseDate: "2026-09-18",
      },
    );
    expect(drafts.some((d) => d.ruleId === "health_deterioration")).toBe(false);
  });

  it("fires large price move and new opportunity list membership", () => {
    const drafts = evaluateAlertDrafts(
      config,
      input({ lastClose: 9, lastCloseDate: "2026-09-18", close1dAgo: 10, close5dAgo: 10, catalystWatch: true }),
      {
        lastResearchScore: 71,
        lastHealthScore: 40,
        lastConcernIds: [],
        lastListIds: [],
        lastEventKeys: [],
        lastClose: 10,
        lastCloseDate: "2026-09-17",
      },
    );
    expect(drafts.some((d) => d.ruleId === "large_price_move")).toBe(true);
    expect(drafts.some((d) => d.ruleId === "new_opportunity" && d.fingerprint === "undervalued")).toBe(true);
    expect(drafts.some((d) => d.ruleId === "new_opportunity" && d.fingerprint === "catalyst")).toBe(true);
  });
});
