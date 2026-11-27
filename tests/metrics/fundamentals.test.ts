import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { parseFundamentalsCsv } from "@/ingest/providers/csv-fundamentals";
import { computeMetrics } from "@/metrics/compute";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import type { StatementSnapshot } from "@/metrics/types";
import { scoreUniverse } from "@/scoring/score";

function annual(overrides: Partial<StatementSnapshot> = {}): StatementSnapshot {
  return {
    periodEnd: "2024-12-31",
    availableAt: "2025-02-26",
    statementType: "annual",
    source: "fixture",
    fiscalQuarter: null,
    revenue: 100,
    pat: 10,
    eps: 1,
    equity: 50,
    totalDebt: 20,
    cash: 5,
    ocf: 12,
    capex: 3,
    shares: 10,
    dividendPerShare: 0.4,
    navPerShare: null,
    totalAssets: null,
    grossProfit: 40,
    operatingProfit: 15,
    ebitda: 18,
    ebit: 14,
    interestExpense: 2,
    ...overrides,
  };
}

function byId(metrics: ReturnType<typeof computeMetrics>, id: string) {
  const found = metrics.find((m) => m.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("fundamental metrics", () => {
  it.each([20, -20])("deducts CSV capital spending reported as %i and triggers the negative FCF warning", (capex) => {
    const parsed = parseFundamentalsCsv(`ticker,period_end,available_at,source,pat,equity,ocf,capex\nTEST,2024-12-31,2025-02-26,fixture,10,50,12,${capex}`);
    expect(parsed.rejected).toEqual([]);
    const [row] = parsed.accepted;
    expect(row.lineItems.capex).toBe(capex);
    const config = loadScoringConfig();
    const asOf = "2026-09-25";
    const instrumentType = "COMMON_STOCK" as const;
    const periods = [{ ...row, lineItemsJson: JSON.stringify(row.lineItems) }];
    const metrics = snapshotsToMetrics({ instrumentType, periods, bars: [], asOf, config });
    expect(byId(metrics, "fcf")).toMatchObject({ value: -8, available: true });
    const score = scoreUniverse([{ config, asOf, ticker: row.ticker, instrumentType, metrics }]).get(row.ticker)!;
    expect(score.concerns).toContainEqual(expect.objectContaining({ id: "negative_fcf", value: -8, penaltyPoints: 5 }));
    expect(score).toMatchObject({ researchScore: 45, warningPenalty: { scoreBefore: 50, points: 5 } });
  });

  it("marks missing inputs unavailable instead of treating them as zero", () => {
    const metrics = computeMetrics({
      instrumentType: "COMMON_STOCK",
      periods: [annual({ cash: null, ocf: null, capex: null, grossProfit: null })],
      bars: [],
    });
    expect(byId(metrics, "net_debt").available).toBe(false);
    expect(byId(metrics, "net_debt").reason).toMatch(/not treated as zero/);
    expect(byId(metrics, "fcf").available).toBe(false);
    expect(byId(metrics, "gross_margin").available).toBe(false);
    expect(byId(metrics, "net_margin").value).toBeCloseTo(0.1);
  });

  it("does not invent a net margin when revenue is zero", () => {
    const metrics = computeMetrics({
      instrumentType: "COMMON_STOCK",
      periods: [annual({ revenue: 0, pat: 10 })],
      bars: [],
    });
    expect(byId(metrics, "net_margin").available).toBe(false);
    expect(byId(metrics, "net_margin").reason).toBe("Division by zero");
    expect(byId(metrics, "roe").available).toBe(true);
    expect(byId(metrics, "roe").value).toBeCloseTo(0.2);
  });

  it("does not invent ROE when equity is zero", () => {
    const metrics = computeMetrics({
      instrumentType: "COMMON_STOCK",
      periods: [annual({ equity: 0, pat: 10 })],
      bars: [],
    });
    expect(byId(metrics, "roe").available).toBe(false);
    expect(byId(metrics, "roe").reason).toMatch(/denominator is not positive/);
  });

  it("keeps negative EPS and refuses P/E instead of using zero", () => {
    const metrics = computeMetrics({
      instrumentType: "COMMON_STOCK",
      periods: [annual({ eps: -0.5, pat: -8 })],
      bars: [{ barDate: "2026-09-18", close: 10, high: 11, low: 9 }],
    });
    expect(byId(metrics, "eps").available).toBe(true);
    expect(byId(metrics, "eps").value).toBe(-0.5);
    expect(byId(metrics, "price_to_earnings").available).toBe(false);
    expect(byId(metrics, "price_to_earnings").value).toBeNull();
    expect(byId(metrics, "price_to_earnings").reason).toMatch(/negative/);
  });

  it("does not force REIT names through industrial leverage, FCF, or EV/EBITDA", () => {
    const metrics = computeMetrics({
      instrumentType: "REIT",
      periods: [annual()],
      bars: [{ barDate: "2026-09-18", close: 8, high: 8.2, low: 7.8 }],
    });
    expect(byId(metrics, "fcf").available).toBe(false);
    expect(byId(metrics, "fcf").reason).toMatch(/REIT/);
    expect(byId(metrics, "net_debt_to_ebitda").available).toBe(false);
    expect(byId(metrics, "interest_coverage").available).toBe(false);
    expect(byId(metrics, "ev_ebitda").available).toBe(false);
    expect(byId(metrics, "net_margin").available).toBe(true);
    expect(byId(metrics, "book_nav_per_share").value).toBeCloseTo(5);
    expect(byId(metrics, "price_to_book").value).toBeCloseTo(1.6);
    expect(byId(metrics, "reit_gearing").available).toBe(true);
    expect(byId(metrics, "nav_per_share").available).toBe(false);
    expect(byId(metrics, "nav_premium").available).toBe(false);
    expect(byId(metrics, "nav_premium").reason).toMatch(/not in the CSV/);
  });

  it("marks bank overlay industrial FCF and EV/EBITDA unavailable", () => {
    const metrics = computeMetrics({
      instrumentType: "COMMON_STOCK",
      ticker: "MAYBANK",
      periods: [annual({ shares: null, cash: 5, ocf: 12, capex: 3 })],
      bars: [{ barDate: "2026-09-18", close: 10, high: 11, low: 9 }],
    });
    expect(byId(metrics, "fcf").available).toBe(false);
    expect(byId(metrics, "fcf").reason).toMatch(/Bank overlay/);
    expect(byId(metrics, "ev_ebitda").available).toBe(false);
    expect(byId(metrics, "net_debt_to_ebitda").available).toBe(false);
    expect(byId(metrics, "roe").available).toBe(true);
    expect(byId(metrics, "price_to_book").available).toBe(false);
    expect(byId(metrics, "price_to_book").reason).toMatch(/shares|Denominator/i);
  });

  it("computes DPU CAGR from stored dividend_per_share and does not invent NAV", () => {
    const metrics = computeMetrics({
      instrumentType: "REIT",
      periods: [
        annual({ periodEnd: "2021-12-31", dividendPerShare: 0.3, equity: 50, shares: 10 }),
        annual({ periodEnd: "2024-12-31", dividendPerShare: 0.4, equity: 50, shares: 10 }),
      ],
      bars: [],
    });
    expect(byId(metrics, "dpu_cagr").available).toBe(true);
    expect(byId(metrics, "nav_per_share").available).toBe(false);
  });
});
