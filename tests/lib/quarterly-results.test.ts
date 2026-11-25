import { describe, expect, it } from "vitest";
import { holdingSignals } from "@/lib/holding-signals";
import { latestQuarterlyResultAlert } from "@/lib/quarterly-results";
import type { StatementSnapshot } from "@/metrics/types";
import { parseYahooQuarterlyTimeseries } from "@/providers/yahoo-fundamentals";

function quarter(overrides: Partial<StatementSnapshot> = {}): StatementSnapshot {
  return {
    periodEnd: "2026-09-30",
    availableAt: "2026-11-18",
    statementType: "quarterly",
    fiscalQuarter: 3,
    source: "yahoo-timeseries",
    revenue: 368_515_000,
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
    pat: 61_004_000,
    eps: 0.0158,
    dividendPerShare: null,
    navPerShare: null,
    equity: 2_858_254_000,
    totalDebt: 13_835_000,
    longTermDebt: null,
    currentAssets: null,
    currentLiabilities: null,
    cash: 2_260_966_000,
    ocf: null,
    capex: null,
    shares: null,
    totalAssets: null,
    ...overrides,
  };
}

describe("quarterly results parsing and alerts", () => {
  it("parses Yahoo 3M quarterly timeseries and skips non-3M points", () => {
    const drafts = parseYahooQuarterlyTimeseries(
      {
        timeseries: {
          result: [
            {
              quarterlyNetIncome: [
                { asOfDate: "2025-09-30", periodType: "3M", reportedValue: { raw: 51_500_000 } },
                { asOfDate: "2026-09-30", periodType: "3M", reportedValue: { raw: 61_000_000 } },
                { asOfDate: "2026-09-30", periodType: "TTM", reportedValue: { raw: 999_000_000 } },
              ],
            },
            {
              quarterlyTotalDebt: [
                { asOfDate: "2025-09-30", periodType: "3M", reportedValue: { raw: 14_600_000 } },
                { asOfDate: "2026-09-30", periodType: "3M", reportedValue: { raw: 13_800_000 } },
              ],
            },
          ],
        },
      },
      "yahoo-timeseries",
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({
      periodEnd: "2026-09-30",
      fiscalYear: 2026,
      fiscalQuarter: 3,
      fiscalPeriod: "Q3 FY2026",
      statementType: "quarterly",
      lineItems: expect.objectContaining({ pat: 61_000_000, totalDebt: 13_800_000 }),
    });
  });

  it("compares latest quarter profit and debt against the same quarter a year earlier", () => {
    const alert = latestQuarterlyResultAlert(
      [
        quarter({ periodEnd: "2026-09-30", availableAt: "2026-11-18", pat: 61_004_000, totalDebt: 13_835_000 }),
        quarter({ periodEnd: "2025-09-30", availableAt: "2025-11-19", pat: 51_499_000, totalDebt: 14_621_000 }),
      ],
      "2026-11-24",
    );
    expect(alert).not.toBeNull();
    expect(alert?.periodEnd).toBe("2026-09-30");
    expect(alert?.priorPeriodEnd).toBe("2025-09-30");
    expect(alert?.summary).toContain("Profit RM 61.0M (up 18% vs RM 51.5M a year earlier)");
    expect(alert?.summary).toContain("Debt RM 13.8M (down 5% vs RM 14.6M a year earlier)");
  });

  it("handles turnaround profits, missing prior-year quarters, and stale quarters", () => {
    const turnaround = latestQuarterlyResultAlert(
      [
        quarter({ periodEnd: "2026-09-30", availableAt: null, pat: 12_000_000, totalDebt: 0 }),
        quarter({ periodEnd: "2025-09-30", availableAt: null, pat: -5_000_000, totalDebt: 0 }),
      ],
      "2026-11-24",
    );
    expect(turnaround?.summary).toContain("turned profitable");
    expect(turnaround?.summary).toContain("No debt reported");

    const noPrior = latestQuarterlyResultAlert(
      [quarter({ periodEnd: "2026-09-30", availableAt: "2026-11-18", pat: 10_000_000, totalDebt: null })],
      "2026-11-24",
    );
    expect(noPrior?.summary).toContain("last year unavailable");
    expect(noPrior?.summary).toContain("Debt unavailable");

    const stale = latestQuarterlyResultAlert(
      [quarter({ periodEnd: "2025-03-31", availableAt: "2025-05-20" })],
      "2026-11-24",
    );
    expect(stale).toBeNull();
  });

  it("includes new-results in holdingSignals for active listings only", () => {
    const periods = [
      quarter({ periodEnd: "2026-09-30", availableAt: "2026-11-18", pat: 61_004_000, totalDebt: 13_835_000 }),
      quarter({ periodEnd: "2025-09-30", availableAt: "2025-11-19", pat: 51_499_000, totalDebt: 14_621_000 }),
    ];
    const active = holdingSignals({ priceDown: null, priceDate: "2026-11-24", periods });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: "new-results", title: "New quarterly results", date: "2026-11-18" });

    const inactive = holdingSignals({ priceDown: null, priceDate: "2026-11-24", periods, inactive: true });
    expect(inactive).toEqual([]);
  });
});
