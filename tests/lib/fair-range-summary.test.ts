import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FairRangePill } from "@/components/research/fair-range-pill";
import type { FairRangeHeadline, FairRangePosition } from "@/lib/fair-range";
import { fairRangeGap, fairRangeSummary } from "@/lib/fair-range-summary";

function range(position: FairRangePosition | null, price: number | null = null): FairRangeHeadline {
  return { available: true, low: 1.203, high: 1.502, middle: 1.3, price, position, positionText: null, methodCount: 2, wideSpread: false, caution: false };
}

describe("list fair ranges", () => {
  it.each(["below", "inside", "above"] as const)("labels %s and rounds estimates to half sen", position => {
    const summary = fairRangeSummary(range(position));
    expect(summary.label).toBe(`${position[0].toUpperCase()}${position.slice(1)} fair range`);
    expect(summary.text).toBe("Fair RM\u00a01.205–RM\u00a01.50");
    const html = renderToStaticMarkup(createElement(FairRangePill, { range: range(position) }));
    expect(html).toContain(summary.label);
    expect(html).toContain("title=");
  });

  it("keeps missing and unreadable valuations short", () => {
    expect(fairRangeSummary(undefined)).toEqual({ label: "No fair range", text: null, detail: null, position: null });
    const unavailable: FairRangeHeadline = { available: false, reason: "Unreadable stored valuation" };
    expect(fairRangeSummary(unavailable).label).toBe("No fair range");
    const html = renderToStaticMarkup(createElement(FairRangePill, { range: unavailable }));
    expect(html).toContain("No fair range");
    expect(html).not.toContain(unavailable.reason);
  });

  it("does not imply a price position when no comparison is available", () => {
    expect(fairRangeSummary(range(null))).toMatchObject({ label: "Price unavailable", position: null });
  });

  it("says how far below or above the fair range today's price is", () => {
    expect(fairRangeGap(range("below", 1))?.percent).toBeCloseTo(16.9, 1);
    expect(fairRangeSummary(range("below", 1)).label).toBe("17% below fair range");
    expect(fairRangeSummary(range("above", 1.8)).label).toBe("20% above fair range");
    expect(fairRangeSummary(range("below", 1.2)).label).toBe("Just below fair range");
    const html = renderToStaticMarkup(createElement(FairRangePill, { range: range("above", 1.8) }));
    expect(html).toContain("20% above fair range");
    expect(html).toContain("amber");
  });

  it("says where inside the fair range the price sits", () => {
    expect(fairRangeSummary(range("inside", 1.25))).toMatchObject({ label: "Inside fair range", detail: "near the low end" });
    expect(fairRangeSummary(range("inside", 1.35))).toMatchObject({ detail: "around the middle" });
    expect(fairRangeSummary(range("inside", 1.48))).toMatchObject({ detail: "near the high end" });
    expect(renderToStaticMarkup(createElement(FairRangePill, { range: range("inside", 1.25) }))).toContain("near the low end · Fair");
  });
});
