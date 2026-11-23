import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockBrief } from "@/components/research/stock-brief";
import { buildStockBrief } from "@/lib/stock-brief";
import type { LineItems } from "@/ingest/types";
import type { PeerQuality } from "@/scoring/peer-group";

function annual(periodEnd: string, items: Partial<LineItems>, actualOrEstimate = "actual") {
  return { periodEnd, statementType: "annual", source: "fixture", lineItemsJson: JSON.stringify(items), actualOrEstimate };
}

const base = {
  ticker: "EXAMPLE",
  profile: "GENERAL",
  industry: "Water",
  sector: "Utilities",
  periods: [],
  close: 2,
  fairRange: { available: false, reason: "Too few peers" } as const,
  priceDrop: null,
  pn17: false,
  warningFlag: false,
  needsVerification: false,
};

describe("stock brief", () => {
  it("puts cash, debt, and a weaker year in context without calling the stock a bargain", () => {
    const brief = buildStockBrief({
      ...base,
      periods: [
        annual("2026-12-31", { pat: 500e6 }, "estimate"),
        annual("2025-12-31", { pat: 40e6, eps: 8, equity: 300e6, shares: 100e6, revenue: 200e6, ocf: 20e6, capex: 30e6, totalDebt: 80e6, cash: 85e6 }),
        annual("2024-12-31", { pat: 50e6, revenue: 180e6, totalDebt: 40e6 }),
      ],
      dividendQuote: { annualYieldPercent: 3.23, checkedAt: "2026-11-23T15:02:00Z" },
    });
    expect(brief.periodEnd).toBe("2025-12-31");
    expect(brief.business).toBe("Listed industry: Water.");
    expect(brief.positives.join(" ")).toMatch(/annual profit.*exceeded debt/);
    expect(brief.risks.join(" ")).toMatch(/profit down 20%.*used RM.*Debt rose 100%/);
    expect(brief.pricing).toMatch(/5\.0× reported annual profit.*33% below reported net assets.*No reliable fair range/);
    expect(brief.dividend).toContain("3.2% (provider estimate, 2026-11-23)");
    expect(brief.watch).toContain("Check what the extra borrowing funded and whether debt keeps rising.");
    const markup = renderToStaticMarkup(createElement(StockBrief, { brief, ticker: base.ticker }));
    expect(markup).toContain("What to watch next");
    expect(markup).toContain("Similar companies");
    expect(markup).toContain("Latest headlines");
    expect(markup).toContain("Loading dividend track record");
  });

  it("does not show a positive earnings multiple for a loss, even with positive reported EPS", () => {
    const brief = buildStockBrief({
      ...base,
      periods: [annual("2025-12-31", { pat: -2e6, eps: 0.02, shares: 100e6 })],
    });
    expect(brief.pricing).not.toContain("annual profit per share");
    expect(brief.risks).toContain("The latest full-year accounts show a loss.");
  });

  it("retains a saved zero yield instead of falling back to an older positive payment", () => {
    const brief = buildStockBrief({
      ...base,
      periods: [annual("2025-12-31", { dividendPerShare: 0.08 })],
      dividendQuote: { annualYieldPercent: 0, checkedAt: "2026-11-23T15:02:00Z" },
    });
    expect(brief.dividend).toContain("0.0% (provider estimate, 2026-11-23)");
    expect(buildStockBrief({ ...base, periods: [annual("2025-12-31", { dividendPerShare: 0 })] }).dividend).toContain("0.0% at the last close");
  });

  it("shows sharp falls and reported share count changes without inventing an explanation", () => {
    const brief = buildStockBrief({
      ...base,
      periods: [
        annual("2025-05-31", { pat: 20e6, shares: 120e6 }),
        annual("2024-05-31", { pat: 1e6, shares: 120e6 }),
        annual("2023-05-31", { pat: 10e6, shares: 100e6 }),
      ],
      priceDrop: { drop: 0.23, adjusted: true, lastClose: 0.77, highClose: 1, highDate: "2026-09-20", lastDate: "2026-11-23" },
    });
    expect(brief.risks).toEqual([
      expect.stringContaining("Annual profit swung"),
      "Reported share count rose 20% in 2 years.",
    ]);
    expect(brief.priceDrop).toMatch(/fell 23%.*2026-09-20.*2026-11-23.*don’t tell us why/);
    expect(brief.watch[0]).toContain("what drove the price drop");
    expect(brief.dividend).toContain("not confirmed");
  });

  it("does not infer trends across missing annual accounts or use another profile’s debt checks", () => {
    const brief = buildStockBrief({
      ...base,
      profile: "BANK",
      periods: [
        annual("2025-12-31", { revenue: 100e6, pat: 20e6, shares: 120e6, ocf: 1e6, capex: 2e6, totalDebt: 300e6 }),
        annual("2023-12-31", { revenue: 90e6, pat: 34e6, shares: 100e6, totalDebt: 100e6 }),
      ],
    });
    expect(brief.risks).toEqual([]);
    expect(brief.positives.join(" ")).not.toContain("sales");
    expect(brief.pricing).toContain("12.0× reported annual profit per share");
  });

  it("compares net assets only with usable comparable companies", () => {
    const book: PeerQuality["metrics"][number] = {
      metricId: "price_to_book", label: "Price / book", usableCount: 5, subject: 0.6, median: 0.9,
      vsMedian: "below", contextLabel: "POSITIVE", reason: null,
    };
    const peers: PeerQuality = {
      groupType: "INDUSTRY", selectionPath: "exact industry “Water”",
      classificationUsed: { researchProfile: "GENERAL", industry: "Water", sector: "Utilities" },
      minRequired: 5, eligibleCount: 10, usableCount: 8, metrics: [book], contextLabel: "POSITIVE", unavailableReason: null,
    };
    expect(buildStockBrief({ ...base, peers }).peers).toContain("0.6× net assets per share, versus 0.9× for the middle of 5 other same-industry companies");
    expect(buildStockBrief({ ...base, peers: { ...peers, groupType: "INDUSTRY_FAMILY" } }).peers).toContain("Broader industries are not used");
    expect(buildStockBrief({ ...base, peers: { ...peers, groupType: "SECTOR" } }).peers).not.toContain("0.9×");
    expect(buildStockBrief({ ...base, industry: "Specialty Chemicals", peers: {
      ...peers, classificationUsed: { ...peers.classificationUsed, industry: "Specialty Chemicals" },
    } }).peers).not.toContain("0.9×");
    expect(buildStockBrief({ ...base, peers: { ...peers, metrics: [{ ...book, usableCount: 4 }] } }).peers).toContain("Not enough usable net asset figures");
    expect(buildStockBrief({ ...base, profile: "BANK", peers: {
      ...peers, groupType: "BANK_PROFILE", classificationUsed: { researchProfile: "BANK", industry: "Banks", sector: "Financials" },
    } }).peers).toContain("5 other banks");
  });
});
