import { describe, expect, it } from "vitest";
import { buildFullMarkdown } from "@/export/full";
import { EXPORT_SCHEMA, type ExportPayload } from "@/export/payload";
import { buildQuickMarkdown } from "@/export/quick";
import { buildRawJson, buildTablesCsv } from "@/export/raw";
import { loadScoringConfig } from "@/config/load-scoring";
import type { MetricValue } from "@/metrics/types";
import { scoreFromMetrics } from "@/scoring/score";

function m(id: string, value: number | null, available = value !== null): MetricValue {
  return {
    id,
    label: id,
    value,
    unit: "ratio",
    available,
    reason: available ? null : "unavailable in fixture",
    period: "2024-12-31",
    inputs: [{ name: id, value }],
    formula: id,
  };
}

function wrap(
  instrument_type: "COMMON_STOCK" | "REIT",
  ticker: string,
  metrics: MetricValue[],
): ExportPayload {
  const score = scoreFromMetrics({
    config: loadScoringConfig(),
    instrumentType: instrument_type,
    metrics,
  });
  return {
    schema: EXPORT_SCHEMA,
    disclaimer:
      "Decision-support research only. Not a buy or sell recommendation. Missing values are null or labelled Data unavailable; they are never invented.",
    instrument: {
      ticker,
      name: ticker,
      instrument_type,
      bursa_code: "0000",
      sector: "Test",
      pn17: false,
      currency: "MYR",
    },
    score,
    dates: {
      score_as_of: score.asOf,
      last_trade_date: "2026-09-18",
      fundamentals_period: "2024-12-31",
      lag_note:
        "Stored annual fundamentals end 2024-12-31 (FY2024). Price as-of / last trade is 2026-09-18. Score run date is not a new filing year.",
    },
    metrics,
    events: [],
    financial_periods: [
      {
        period_end: "2024-12-31",
        available_at: "2025-02-28",
        retrieved_at: "2026-09-01",
        statement_type: "annual",
        source: "csv-sample",
        actual_or_estimate: "actual",
        line_items: {
          revenue: 100,
          pat: 10,
          eps: 0.5,
          equity: 200,
          totalDebt: null,
          cash: 20,
          ocf: 12,
          capex: -5,
          shares: 100,
          dividendPerShare: 0.1,
          navPerShare: null,
          totalAssets: null,
        },
      },
    ],
  };
}

describe("ChatGPT export", () => {
  const common = wrap("COMMON_STOCK", "MAYBANK", [
    m("price_to_earnings", 12),
    m("dividend_yield", 0.05),
    m("roe", 0.12),
    m("net_margin", 0.12),
    m("revenue_cagr", 0.06),
    m("pat_cagr", 0.06),
  ]);

  it("includes instrument_type and ScoreResult in raw JSON", () => {
    const parsed = JSON.parse(buildRawJson(common)) as ExportPayload;
    expect(parsed.schema).toBe(EXPORT_SCHEMA);
    expect(parsed.instrument.instrument_type).toBe("COMMON_STOCK");
    expect(parsed.score.profile).toBe("default");
    expect(parsed.score.categories.length).toBeGreaterThan(0);
    expect(parsed.score).toHaveProperty("researchScore");
    expect(parsed.score).toHaveProperty("dataConfidence");
    expect(parsed.score).toHaveProperty("dataCoverage");
    expect(parsed.score.categories.every((c) => typeof c.coverage === "number")).toBe(true);
    expect(parsed.financial_periods[0]?.actual_or_estimate).toBe("actual");
  });

  it("Full report includes evidence, coverage, dates, sources, actual vs estimate", () => {
    const md = buildFullMarkdown(common);
    expect(md).toMatch(/Factor evidence/i);
    expect(md).toMatch(/Data Confidence/);
    expect(md).toMatch(/actual_or_estimate: actual/);
    expect(md).toMatch(/source: csv-sample/);
    expect(md).toMatch(/available_at: 2025-02-28/);
    expect(md).toMatch(/fundamentals period/);
    expect(md).toMatch(/price as-of \/ last trade/);
    expect(md).toMatch(/instrument_type/);
    expect(md).toMatch(/Data unavailable/);
    expect(md).toMatch(/Historical Context/);
    expect(md).toMatch(/Peer Context/);
    expect(md).not.toMatch(/\bBUY\b/);
    expect(md).not.toMatch(/\bSELL\b/);
  });

  it("Quick report stays concise and names the profile", () => {
    const md = buildQuickMarkdown(common);
    expect(md).toMatch(/instrument_type: COMMON_STOCK/);
    expect(md).toMatch(/scoring factor set: default/);
    expect(md.length).toBeLessThan(buildFullMarkdown(common).length);
  });

  it("REIT export uses the REIT profile, not industrial FCF factors", () => {
    const reit = wrap("REIT", "KLCC", [m("dividend_yield", 0.06), m("revenue_cagr", 0.04)]);
    expect(reit.score.profile).toBe("reit");
    const ids = reit.score.categories.flatMap((c) => c.factors.map((f) => f.id));
    expect(ids).toContain("dpu_yield");
    expect(ids).not.toContain("fcf");
    const md = buildFullMarkdown(reit);
    expect(md).toMatch(/REIT factor profile/);
    expect(md).toMatch(/ordinary-company P\/E are not scoring factors/);
    expect(JSON.parse(buildRawJson(reit)).instrument.instrument_type).toBe("REIT");
    expect(buildTablesCsv(reit)).toMatch(/REIT/);
  });

  it("CSV includes factor and financial tables without inventing blanks as zero", () => {
    const csv = buildTablesCsv(common);
    expect(csv).toMatch(/financial_period/);
    expect(csv).toMatch(/factor/);
    const debtCell = csv.split("\n").find((line) => line.startsWith("financial_period"));
    expect(debtCell).toBeDefined();
    const parts = debtCell!.split(",");
    expect(parts.some((p) => p === "")).toBe(true);
  });
});
