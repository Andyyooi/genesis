import { describe, expect, it } from "vitest";
import { emptyLineItems, mergeLineItems } from "@/ingest/merge-line-items";
import {
  classifyEmptyYahooResult,
  classifyHttpFailure,
  isUnsupportedYahooListing,
} from "@/providers/fundamental-failures";
import { parseYahooTimeseries } from "@/providers/yahoo-fundamentals";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";

describe("yahoo symbol mapping", () => {
  it("prefers stored yahoo_ticker then Bursa code .KL", () => {
    expect(
      yahooSymbolCandidates({ yahooTicker: "1155.KL", bursaCode: "1155", ticker: "MAYBANK" }),
    ).toEqual(["1155.KL"]);
    expect(yahooSymbolCandidates({ yahooTicker: null, bursaCode: "0328", ticker: "3REN" })).toEqual([
      "0328.KL",
    ]);
  });
});

describe("line-item merge", () => {
  it("fills nulls and never overwrites a stored number", () => {
    const existing = { ...emptyLineItems(), revenue: 10, equity: null };
    const incoming = { ...emptyLineItems(), revenue: 99, equity: 5, pat: 1 };
    const merged = mergeLineItems(existing, incoming);
    expect(merged.revenue).toBe(10);
    expect(merged.equity).toBe(5);
    expect(merged.pat).toBe(1);
  });
});

describe("yahoo timeseries parse", () => {
  it("maps annual 12M points and takes abs capex", () => {
    const periods = parseYahooTimeseries(
      {
        timeseries: {
          result: [
            {
              annualTotalRevenue: [
                { asOfDate: "2024-12-31", periodType: "12M", reportedValue: { raw: 100 } },
              ],
              annualCapitalExpenditure: [
                { asOfDate: "2024-12-31", periodType: "12M", reportedValue: { raw: -20 } },
              ],
              annualStockholdersEquity: [
                { asOfDate: "2024-12-31", periodType: "12M", reportedValue: { raw: 50 } },
              ],
            },
          ],
        },
      },
      "yahoo-timeseries",
    );
    expect(periods).toHaveLength(1);
    expect(periods[0]?.lineItems.revenue).toBe(100);
    expect(periods[0]?.lineItems.capex).toBe(20);
    expect(periods[0]?.lineItems.equity).toBe(50);
    expect(periods[0]?.availableAt).toBeNull();
  });
});

describe("failure codes", () => {
  it("classifies rate limits, empty results, and ETF names", () => {
    expect(classifyHttpFailure(429)).toBe("RATE_LIMIT");
    expect(classifyHttpFailure(404)).toBe("TICKER_MAPPING_ERROR");
    expect(isUnsupportedYahooListing("ABF Malaysia Bond Index")).toBe(true);
    expect(classifyEmptyYahooResult({ name: "3REN Berhad", mappingTried: ["0328.KL"] })).toBe("NO_DATA");
  });
});
