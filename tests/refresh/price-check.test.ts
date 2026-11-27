import { describe, expect, it } from "vitest";
import { findPriceIssues, priceCheckIssueCount, priceCoverageLines, priceCheckSummary, priceNewestTooOld, type PriceCheckInput } from "@/refresh/price-check";

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
  it("counts stocks with closes for both of the last two trading days and reports retries", () => {
    const report = findPriceIssues(
      [
        stock("MAYBANK", [10, 10, 10, 10, 10, 10]),
        stock("GAP", [10, 10, 10, 10, 10], ["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-20"]),
        stock("MKH", [2, 2], ["2026-10-26", "2026-10-27"]),
        { ticker: "NONE", name: "None Bhd", latestDate: null, bars: [] },
      ],
      { checkedAt: "2026-11-21T10:00:00Z", marketDate: "2026-11-21", failedThisRun: ["AIZOPA", "NONE"], retried: ["NONE", "TENAGA"], recoveredOnRetry: ["TENAGA"] },
    );
    expect(report).toMatchObject({ newestDate: "2026-11-20", previousDate: "2026-11-19", freshCount: 1, failedThisRun: ["NONE"], retried: ["NONE"], recoveredOnRetry: [] });
    const listedOnly = findPriceIssues([stock("MAYBANK", [10, 10, 10, 10, 10, 10]), stock("TENAGA", [10, 10])], { checkedAt: "x", retried: ["TENAGA", "GONE"], recoveredOnRetry: ["TENAGA"] });
    expect(listedOnly).toMatchObject({ retried: ["TENAGA"], recoveredOnRetry: ["TENAGA"] });
    const lines = priceCoverageLines(report);
    expect(lines[0]).toBe("1 of 4 listed stocks (25%) have closes for both 2026-11-20 and 2026-11-19.");
    expect(lines.join("\n")).toMatch(/Still not downloaded: NONE\./);
    expect(lines.join("\n")).toMatch(/older than 2026-11-20: MKH \(2026-10-27\)/);
    expect(lines.join("\n")).toMatch(/No saved price: NONE\./);
    expect(priceCoverageLines(listedOnly).join("\n")).toMatch(/Retried 1 after a failed download; 1 recovered\./);
    expect(priceCoverageLines(findPriceIssues([], { checkedAt: "x" }))[0]).toMatch(/not enough saved closing days/);
  });
});
