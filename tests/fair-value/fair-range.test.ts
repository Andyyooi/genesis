import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FairRangeLine } from "@/components/research/fair-range-line";
import { FairRangePill } from "@/components/research/fair-range-pill";
import type { FairValueRunRead } from "@/fair-value/load-run";
import type { FairValueMethodKind } from "@/fair-value/types";
import { fairRangeHeadline } from "@/lib/fair-range";
import { PersistedFairValue } from "@/components/research/persisted-fair-value";
import { BROAD_PEERS_WITHHELD, NO_COMPARABLE_PEERS } from "@/fair-value/comparable-peers";

function stored(
  values: (number | null)[],
  baseUse = "POINT_OK",
  base: number | null = null,
  flaggedIndexes: number[] = [],
  kinds: FairValueMethodKind[] = [],
): FairValueRunRead {
  return {
    ok: true,
    run: {
      id: 1,
      instrumentId: 1,
      calculatedAt: "2026-11-20",
      observationKey: "k",
      qualityVersion: "fair-value-quality-v1",
      quality: {
        baseUse,
        methods: values.map((_, index) => ({ id: `m${index}`, state: flaggedIndexes.includes(index) ? "FLAGGED" : "CLEAR" })),
      } as never,
      result: {
        currentPrice: 0.99,
        fairValueBase: base,
        methods: values.map((methodValue, index) => ({ id: `m${index}`, available: methodValue != null, methodValue, kind: kinds[index] })),
      } as never,
    },
  };
}

describe("fairRangeHeadline", () => {
  it.each([
    ["INDUSTRY_FAMILY", "industry family “Utilities - *”"],
    ["SECTOR", "same sector “Utilities”"],
    ["INDUSTRY", "exact industry “Specialty Chemicals”"],
  ] as const)("hides saved estimates based on broad %s comparisons", (peerGroupType, peerSelectionPath) => {
    const storedRun = stored([4.3, 6.08], "POINT_OK", 5);
    if (!storedRun.ok) throw new Error("Expected readable run");
    storedRun.run.result.researchProfile = "GENERAL";
    storedRun.run.result.assumptions = { peerGroupType, peerSelectionPath } as typeof storedRun.run.result.assumptions;
    expect(fairRangeHeadline(storedRun, 1.85)).toEqual({ available: false, reason: BROAD_PEERS_WITHHELD });
    expect(renderToStaticMarkup(createElement(PersistedFairValue, { stored: storedRun }))).toContain(BROAD_PEERS_WITHHELD);
  });

  it("explains that a valid history-only range does not use peers", () => {
    const storedRun = stored([1.1, 1.2], "POINT_OK", 1.15, [], ["history", "history"]);
    if (!storedRun.ok) throw new Error("Expected readable run");
    storedRun.run.result.researchProfile = "GENERAL";
    storedRun.run.result.assumptions = { peerGroupType: "NONE", peerUnavailableReason: NO_COMPARABLE_PEERS } as typeof storedRun.run.result.assumptions;
    const range = fairRangeHeadline(storedRun, 1.15);
    expect(range).toMatchObject({ available: true, peerNote: expect.stringContaining("own trading history") });
    expect(renderToStaticMarkup(createElement(FairRangeLine, { range, compact: true }))).toContain("Too few similar companies");
  });

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

  it("keeps both estimates when only two methods worked", () => {
    const range = fairRangeHeadline(stored([1, 2]), 1.1);
    expect(range.available && [range.low, range.high]).toEqual([1, 2]);
    expect(range.available && range.position).toBe("inside");
  });

  it("leaves out methods the quality checks flagged", () => {
    const range = fairRangeHeadline(stored([1, 1.2, 623.03], "POINT_WITH_CAUTION", 1.2, [2]), 1.1);
    expect(range.available && range.high).toBe(1.2);
    expect(range.available && range.caution).toBe(true);
  });

  it.each([
    { kinds: ["peer", "peer", "history"], flagged: [2], comparison: "similar companies suggest" },
    { kinds: ["history", "history", "peer"], flagged: [2], comparison: "its own trading history suggests" },
    { kinds: ["peer", "history", "peer"], flagged: [], comparison: "similar companies and its own past suggest" },
  ] satisfies { kinds: FairValueMethodKind[]; flagged: number[]; comparison: string }[])(
    "uses only the sources of estimates that made it into the range: $comparison", ({ kinds, flagged, comparison }) => {
      const range = fairRangeHeadline(stored([1, 1.2, 1.3], "POINT_OK", 1.2, flagged, kinds), 2);
      const phrase = `dearer than ${comparison}.`;
      expect(renderToStaticMarkup(createElement(FairRangeLine, { range }))).toContain(phrase);
      expect(renderToStaticMarkup(createElement(FairRangePill, { range }))).toContain(phrase);
    },
  );

  it("is unavailable when checks fail or only one method worked", () => {
    expect(fairRangeHeadline(stored([1, 2], "POINT_WITHHELD"), 1).available).toBe(false);
    expect(fairRangeHeadline(stored([1.5, null]), 1).available).toBe(false);
    expect(fairRangeHeadline(null, 1).available).toBe(false);
  });

  it("shows the model's plain reason when it cannot produce a range", () => {
    const run = stored([], "NO_POINT");
    if (!run.ok) throw new Error("Expected a readable run");
    run.run.result.researchProfile = "UNKNOWN";
    run.run.result.unavailableReason = "This is a shell company. There is no operating business to compare.";
    const range = fairRangeHeadline(run, 1);
    expect(range).toEqual({ available: false, reason: run.run.result.unavailableReason });
    expect(renderToStaticMarkup(createElement(FairRangeLine, { range }))).toContain("This is a shell company.");
  });

  it("renders a plain line with half-sen prices", () => {
    const html = renderToStaticMarkup(createElement(FairRangeLine, { range: fairRangeHeadline(stored([1.6, 1.8, 2.0]), 1.755) }));
    expect(html).toContain("Fair range RM");
    expect(html).toContain("1.755");
    expect(html).toContain("not a promise the price will get there");
  });
});
