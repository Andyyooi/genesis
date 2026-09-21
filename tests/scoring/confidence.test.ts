import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import { assessObservationFreshness } from "@/scoring/freshness";
import { scoreFromMetrics } from "@/scoring/score";

const AS_OF = "2026-09-20T00:00:00.000Z";

function m(
  id: string,
  value: number | null,
  period: string | null,
  available = value !== null,
): MetricValue {
  return {
    id,
    label: id,
    value,
    unit: "ratio",
    available,
    reason: available ? null : "unavailable in fixture",
    period,
    inputs: [{ name: id, value }],
    formula: id,
  };
}

const config = loadScoringConfig();

const recentCore = [
  m("price_to_earnings", 12, "2025-06-30"),
  m("dividend_yield", 0.05, "2025-06-30"),
  m("roe", 0.14, "2025-06-30"),
  m("net_margin", 0.12, "2025-06-30"),
  m("debt_to_equity", 0.4, "2025-06-30"),
  m("fcf", 1, "2025-06-30"),
  m("net_debt_to_ebitda", 1.2, "2025-06-30"),
  m("revenue_cagr", 0.08, "2025-06-30"),
  m("pat_cagr", 0.08, "2025-06-30"),
];

describe("data freshness", () => {
  it("ages filings from available_at or period_end, never retrieved_at", () => {
    const stale = assessObservationFreshness({
      asOf: AS_OF,
      periodEnd: "2021-12-31",
      availableAt: null,
      retrievedAt: "2026-09-20T00:00:00.000Z",
    });
    expect(stale.band).toBe("VERY_STALE");
    expect(stale.observationDate).toBe("2021-12-31");
    expect((stale.ageMonths ?? 0) >= 48).toBe(true);

    const filed = assessObservationFreshness({
      asOf: AS_OF,
      periodEnd: "2024-12-31",
      availableAt: "2025-02-28",
      retrievedAt: "2026-09-20",
    });
    expect(filed.observationDate).toBe("2025-02-28");
    expect(filed.band).toBe("AGING");
  });
});

describe("data confidence", () => {
  it("well-covered recent filings stay HIGH and do not rewrite raw scores", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: recentCore,
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-15" },
    });
    expect(result.dataCoverage.expected).toBe(9);
    expect(result.dataCoverage.available).toBe(9);
    expect(result.dataCoverage.freshness).toBe("FRESH");
    expect(result.dataConfidence.level).toBe("HIGH");
    expect(result.dataConfidence.needsVerification).toBe(false);
    expect(result.researchScore).not.toBeNull();
    expect(result.valuationScore).toBeGreaterThan(50);
  });

  it("old fundamentals keep the raw score and mark VERY_LOW", () => {
    const old = recentCore.map((row) => ({ ...row, period: "2021-12-31" }));
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: old,
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2021-12-31", availableAt: null },
    });
    const freshTwin = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: recentCore,
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-15" },
    });
    expect(result.researchScore).toBeCloseTo(freshTwin.researchScore ?? 0, 5);
    expect(result.dataCoverage.freshness).toBe("VERY_STALE");
    expect(result.dataConfidence.level).toBe("VERY_LOW");
    expect(result.dataConfidence.reasons.some((r) => /old/i.test(r) || /very stale/i.test(r))).toBe(
      true,
    );
  });

  it("almost empty coverage is VERY_LOW and unavailable is not zero", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [],
      asOf: AS_OF,
    });
    expect(result.researchScore).toBeNull();
    expect(result.valuationScore).toBeNull();
    expect(result.dataCoverage.available).toBe(0);
    expect(result.dataCoverage.unavailable).toBe(result.dataCoverage.expected);
    expect(result.dataConfidence.level).toBe("VERY_LOW");
    expect(result.categories.find((c) => c.id === "quality")?.score).toBeNull();
  });

  it("a 100 valuation on one old yield is flagged for verification", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      metrics: [m("dividend_yield", 0.08, "2021-12-31")],
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2021-12-31", availableAt: null },
    });
    expect(result.valuationScore).toBe(100);
    expect(result.dataCoverage.available).toBe(1);
    expect(result.dataConfidence.level).toBe("VERY_LOW");
    expect(result.dataConfidence.needsVerification).toBe(true);
    expect(result.dataConfidence.reasons.some((r) => /needs verification/i.test(r))).toBe(true);
  });

  it("REIT profile uses REIT expected factors", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "REIT",
      metrics: [
        m("dividend_yield", 0.06, "2025-06-30"),
        m("book_nav_premium", -0.05, "2025-06-30"),
        m("dpu_cagr", 0.04, "2025-06-30"),
        m("reit_gearing", 0.3, "2025-06-30"),
        m("revenue_cagr", 0.04, "2025-06-30"),
      ],
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-01" },
    });
    expect(result.profile).toBe("reit");
    expect(result.dataCoverage.expected).toBe(9);
    expect(result.dataCoverage.available).toBe(5);
    expect(result.dataConfidence.level).toBe("MEDIUM");
    expect(result.categories.flatMap((c) => c.factors.map((f) => f.id))).not.toContain("fcf");
  });

  it("bank overlay declares health metrics unavailable instead of using industrial FCF", () => {
    const result = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      ticker: "MAYBANK",
      industry: "Banks",
      metrics: [
        m("price_to_book", 1.1, "2025-06-30"),
        m("dividend_yield", 0.06, "2025-06-30"),
        m("roe", 0.12, "2025-06-30"),
        m("revenue_cagr", 0.06, "2025-06-30"),
        m("pat_cagr", 0.06, "2025-06-30"),
      ],
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-20" },
    });
    expect(result.profile).toBe("bank");
    expect(result.dataCoverage.expected).toBe(9);
    expect(result.categories.find((c) => c.id === "financial_health")?.factors.length).toBe(4);
    expect(result.categories.find((c) => c.id === "financial_health")?.score).toBeNull();
    expect(result.dataConfidence.level).toBe("MEDIUM");
  });

  it("PN17-unknown does not invent a PN17 feed or change the raw score", () => {
    const clean = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      pn17: false,
      metrics: recentCore,
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-15" },
    });
    const flagged = scoreFromMetrics({
      config,
      instrumentType: "COMMON_STOCK",
      pn17: true,
      metrics: recentCore,
      asOf: AS_OF,
      latestAnnual: { periodEnd: "2025-06-30", availableAt: "2025-08-15" },
    });
    expect(clean.researchScore).toBe(flagged.researchScore);
    expect(clean.dataConfidence.level).toBe(flagged.dataConfidence.level);
    expect(clean.concerns.some((c) => c.id === "pn17")).toBe(false);
    expect(flagged.concerns.some((c) => c.id === "pn17")).toBe(true);
    expect(clean.dataConfidence.reasons.join(" ")).not.toMatch(/PN17 clear/i);
  });
});
