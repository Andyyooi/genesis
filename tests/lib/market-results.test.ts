import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketResults } from "@/components/research/market-results";

const rows = Array.from({ length: 60 }, (_, i) => ({
  ticker: `COMPANY${i + 1}`,
  name: `Company ${i + 1}`,
  eligible: true,
  researchScore: 70,
  valuationScore: 50,
  coreCoverageRatio: 0.75,
  availableFactors: 9,
  expectedFactors: 12,
  confidence: "MEDIUM",
  freshness: "FRESH",
}));

function render(
  requestedPage = "1",
  selectedRows: Record<string, unknown>[] = rows,
  belowFairRange = false,
) {
  return renderToStaticMarkup(
    createElement(MarketResults, {
      rows: selectedRows,
      total: 60,
      query: "bank & trust",
      eligibility: "eligible",
      requestedPage,
      fairRanges: {},
      belowFairRange,
    }),
  );
}

describe("market explorer results", () => {
  it("preserves the one-tap fair-range filter through search and pagination", () => {
    const html = render("1", rows, true);
    expect(html).toContain('name="fair" value="below"');
    expect(html).toContain("q=bank+%26+trust&amp;eligibility=eligible&amp;fair=below&amp;page=2#companies");
    expect(html).toContain("Below fair range · On");
  });
  it("paginates without dropping names and preserves filters in navigation", () => {
    const first = render();
    expect(first).toContain('href="/stock/COMPANY1"');
    expect(first).toContain('href="/stock/COMPANY25"');
    expect(first).not.toContain('href="/stock/COMPANY26"');
    expect(first).toContain(
      "q=bank+%26+trust&amp;eligibility=eligible&amp;page=2#companies",
    );
    const second = render("2");
    expect(second).toContain('href="/stock/COMPANY26"');
    expect(second).toContain('href="/stock/COMPANY50"');
    expect(second).not.toContain('href="/stock/COMPANY25"');
    const last = render("3");
    expect(last).toContain('href="/stock/COMPANY60"');
    expect(last).not.toContain('rel="next"');
  });

  it("bounds invalid and out-of-range pages", () => {
    for (const page of [
      "0",
      "-1",
      "not-a-page",
      "1.5",
      "Infinity",
      "99999999999999999999",
    ]) {
      expect(render(page)).toContain('href="/stock/COMPANY1"');
    }
    expect(render("999")).toContain('href="/stock/COMPANY51"');
  });

  it("keeps unavailable values honest and exclusion evidence accessible", () => {
    const html = render("1", [
      {
        ticker: "THIN",
        name: "Thin Data",
        eligible: false,
        researchScore: null,
        valuationScore: Number.NaN,
        needsVerification: true,
        confidence: "VERY_LOW",
        freshness: "VERY_STALE",
        exclusionReasons: ["Core coverage too low.", "Accounts are stale."],
      },
    ]);
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("0%");
    expect(html).toContain("Needs verification");
    expect(html).toContain("VERY STALE");
    expect(html).toContain("Core coverage too low. Accounts are stale.");
    expect(html).toContain('aria-label="Review THIN: excluded"');
  });

  it("shows coverage with factor counts and handles an empty filter result", () => {
    expect(render()).toContain("75%");
    expect(render()).toContain("9 of 12");
    const empty = render("10", []);
    expect(empty).toContain("No companies match these filters");
    expect(empty).toContain("Clear filters");
    expect(empty).not.toContain('rel="next"');
    expect(empty).not.toContain('rel="prev"');
  });
});
