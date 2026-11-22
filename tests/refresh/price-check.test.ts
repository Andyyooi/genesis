import { describe, expect, it } from "vitest";
import { findPriceIssues, priceCheckIssueCount, priceCheckSummary, priceNewestTooOld, type PriceCheckInput } from "@/refresh/price-check";

const days = ["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const stock = (ticker: string, closes: (number | null)[], dates = days): PriceCheckInput => ({
  ticker,
  name: `${ticker} Bhd`,
  latestDate: dates.at(-1) ?? null,
  bars: closes.map((close, i) => ({ date: dates[i]!, close })),
});

describe("findPriceIssues", () => {
  it("passes steady prices and ignores one-tick penny moves", () => {
    const report = findPriceIssues(
      [stock("MAYBANK", [10, 10.1, 10.2, 10.1, 10, 10.05]), stock("PENNY", [0.01, 0.015, 0.01, 0.015, 0.01, 0.005])],
      { checkedAt: "2026-11-21T10:00:00Z", marketDate: "2026-11-21" },
    );
    expect(priceCheckIssueCount(report)).toBe(0);
    expect(priceNewestTooOld(report)).toBe(false);
    expect(priceCheckSummary(report)).toBeNull();
  });

  it("flags missing, stale and jumping prices and Yahoo misses", () => {
    const report = findPriceIssues(
      [
        stock("MAYBANK", [10, 10, 10, 10, 10, 10]),
        stock("JUMPY", [1, 1, 1, 1, 1, 1.5]),
        stock("OLD", [2, 2], ["2026-10-26", "2026-10-27"]),
        { ticker: "NONE", name: "None Bhd", latestDate: null, bars: [] },
      ],
      { checkedAt: "2026-11-21T10:00:00Z", marketDate: "2026-11-21", failedThisRun: ["OLD", "MAYBANK", "DELISTED"] },
    );
    expect(report.newestDate).toBe("2026-11-20");
    expect(report.jumps).toEqual([{ ticker: "JUMPY", name: "JUMPY Bhd", date: "2026-11-20", from: 1, to: 1.5, changePercent: 50 }]);
    expect(report.stale).toEqual([{ ticker: "OLD", name: "OLD Bhd", lastDate: "2026-10-27" }]);
    expect(report.noPrice.map((s) => s.ticker)).toEqual(["NONE"]);
    expect(report.failedThisRun).toEqual(["MAYBANK", "OLD"]);
    expect(priceCheckIssueCount(report)).toBe(4);
    expect(priceCheckSummary(report)).toMatch(/2 not downloaded.*1 with no saved price.*1 with an older last price.*1 with a jump/);
  });

  it("counts a RM0.05 move as a jump despite rounding", () => {
    const report = findPriceIssues([stock("GIIB", [0.13, 0.13, 0.13, 0.13, 0.13, 0.18])], { checkedAt: "2026-11-21T10:00:00Z" });
    expect(report.jumps.map((j) => j.ticker)).toEqual(["GIIB"]);
  });

  it("only looks for jumps in the recent trading days", () => {
    const report = findPriceIssues([stock("SPLIT", [2, 1, 1, 1, 1, 1, 1], ["2026-11-12", ...days])], { checkedAt: "2026-11-21T10:00:00Z" });
    expect(report.jumps).toHaveLength(0);
  });

  it("warns when the newest price is days older than the refresh", () => {
    const report = findPriceIssues([stock("MAYBANK", [10, 10, 10, 10, 10, 10])], { checkedAt: "2026-11-27T10:00:00Z", marketDate: "2026-11-27" });
    expect(report.newestDaysOld).toBe(7);
    expect(priceNewestTooOld(report)).toBe(true);
    expect(priceCheckSummary(report)).toMatch(/newest price is 7 days old/);
  });
});
