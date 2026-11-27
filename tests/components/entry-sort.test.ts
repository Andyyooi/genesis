import { describe, expect, it } from "vitest";
import { entrySortValue, type WorkspaceRow } from "@/components/research/research-workspace";
import type { ListFairRange } from "@/lib/fair-range-summary";

function row(fairRange: ListFairRange | undefined): WorkspaceRow {
  return { fairRange } as WorkspaceRow;
}

function range(position: "below" | "inside" | "above", low: number, high: number, price: number): ListFairRange {
  return { available: true, position, positionText: null, low, high, price };
}

describe("cheapest vs fair range sort", () => {
  it("puts below-range first, then inside, then above, whatever the range width", () => {
    const values = [
      entrySortValue(row(range("above", 1, 1.1, 1.2))),
      entrySortValue(row(range("inside", 1, 2, 1.9))),
      entrySortValue(row(range("inside", 1, 2, 1.1))),
      entrySortValue(row(range("below", 1, 1.2, 0.95))),
      entrySortValue(row(range("below", 1, 1.2, 0.7))),
    ] as number[];
    expect([...values].sort((a, b) => b - a)).toEqual([values[4], values[3], values[2], values[1], values[0]]);
  });

  it("leaves stocks without a fair range or price unsorted", () => {
    expect(entrySortValue(row(undefined))).toBeNull();
    expect(entrySortValue(row({ available: true, position: "below", low: 1, high: 1.2, price: null }))).toBeNull();
  });
});
