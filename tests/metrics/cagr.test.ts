import { describe, expect, it } from "vitest";
import { cagr } from "@/metrics/cagr";

describe("cagr", () => {
  it("computes a four-year CAGR", () => {
    const result = cagr("c", "C", 100, 146.41, 4, "formula", [], "2020→2024");
    expect(result.available).toBe(true);
    expect(result.value).toBeCloseTo(0.1, 6);
  });

  it("is unavailable when the start is negative", () => {
    const result = cagr("c", "C", -10, 20, 3, "formula", [], "range");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
  });

  it("is unavailable when an input is missing", () => {
    const result = cagr("c", "C", null, 20, 3, "formula", [], "range");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
  });
});
