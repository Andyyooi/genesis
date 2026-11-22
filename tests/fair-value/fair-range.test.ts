import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FairRangeLine } from "@/components/research/fair-range-line";
import type { FairValueRunRead } from "@/fair-value/load-run";
import { fairRangeHeadline } from "@/lib/fair-range";

function stored(values: (number | null)[], baseUse = "POINT_OK", base: number | null = null): FairValueRunRead {
  return {
    ok: true,
    run: {
      id: 1,
      instrumentId: 1,
      calculatedAt: "2026-11-20",
      observationKey: "k",
      qualityVersion: "fair-value-quality-v1",
      quality: { baseUse } as never,
      result: {
        currentPrice: 0.99,
        fairValueBase: base,
        methods: values.map((methodValue) => ({ available: methodValue != null, methodValue })),
      } as never,
    },
  };
}

describe("fairRangeHeadline", () => {
  it("uses the middle half of method values so one outlier does not stretch it", () => {
    const range = fairRangeHeadline(stored([0.817, 1.933, 0.121, 1.796, 0.525, null], "POINT_OK", 0.817), 0.995);
    expect(range.available).toBe(true);
    if (!range.available) return;
    expect(range.low).toBeCloseTo(0.525);
    expect(range.high).toBeCloseTo(1.796);
    expect(range.middle).toBeCloseTo(0.817);
    expect(range.position).toBe("inside");
    expect(range.methodCount).toBe(5);
    expect(range.wideSpread).toBe(true);
  });

  it("places the price below or above the range", () => {
    const below = fairRangeHeadline(stored([2, 2.2, 2.4]), 1.5);
    const above = fairRangeHeadline(stored([2, 2.2, 2.4]), 3);
    expect(below.available && below.position).toBe("below");
    expect(above.available && above.position).toBe("above");
    expect(below.available && below.wideSpread).toBe(false);
  });

  it("is unavailable when checks fail or only one method worked", () => {
    expect(fairRangeHeadline(stored([1, 2], "POINT_WITHHELD"), 1).available).toBe(false);
    expect(fairRangeHeadline(stored([1.5, null]), 1).available).toBe(false);
    expect(fairRangeHeadline(null, 1).available).toBe(false);
  });

  it("renders a plain line with half-sen prices", () => {
    const html = renderToStaticMarkup(createElement(FairRangeLine, { range: fairRangeHeadline(stored([1.6, 1.8, 2.0]), 1.755) }));
    expect(html).toContain("Fair range RM");
    expect(html).toContain("1.755");
    expect(html).toContain("not a promise the price will get there");
  });
});
