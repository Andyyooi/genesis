import { describe, expect, it } from "vitest";
import { dividendTrackRecord } from "@/components/research/dividend-history";
import type { DividendHistory } from "@/providers/yahoo-dividends";

const history: DividendHistory = {
  currency: "MYR",
  symbol: "TEST.KL",
  checkedAt: "2026-11-23",
  years: [
    { year: 2026, toDate: true, perShare: 0.09, payments: 1 },
    { year: 2025, toDate: false, perShare: 0.045, payments: 2 },
    { year: 2024, toDate: false, perShare: 0.05, payments: 1 },
    { year: 2023, toDate: false, perShare: null, payments: 0 },
    { year: 2022, toDate: false, perShare: 0.025, payments: 1 },
  ],
};

describe("dividend track record", () => {
  it("counts full years and compares adjacent reported payments without rounding away half a sen", () => {
    expect(dividendTrackRecord(history)).toBe("Payments reported in 3 of the last 4 full years. 2025: RM 0.045/share vs RM 0.05 in 2024.");
  });

  it("does not compare through gaps or interpret missing payments as zero", () => {
    const years = history.years.map(row => row.year === 2024 ? { ...row, perShare: null } : row);
    expect(dividendTrackRecord({ ...history, years })).not.toContain(" vs ");
    expect(dividendTrackRecord({ ...history, years: years.map(row => row.toDate ? row : { ...row, perShare: null }) })).toContain("No payments reported");
  });
});
