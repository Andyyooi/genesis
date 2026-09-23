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

  it("is unavailable for positive start → negative end (profit to loss)", () => {
    const result = cagr("pat_cagr", "PAT CAGR", 20_354_000, -16_033_000, 3, "formula", [], "range");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
    expect(result.reason?.toLowerCase()).toMatch(/end|sign|negative|zero/);
  });

  it("is unavailable for positive start → zero end", () => {
    const result = cagr("c", "C", 100, 0, 3, "formula", [], "range");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
  });

  it("never returns available with a non-finite value", () => {
    const cases = [
      cagr("c", "C", 100, -50, 3, "formula", [], "range"),
      cagr("c", "C", 100, 0, 2, "formula", [], "range"),
      cagr("c", "C", Number.NaN, 50, 2, "formula", [], "range"),
      cagr("c", "C", 50, Number.POSITIVE_INFINITY, 2, "formula", [], "range"),
    ];
    for (const result of cases) {
      expect(result.available).toBe(false);
      expect(result.value).toBeNull();
      expect(Number.isFinite(result.value as number)).toBe(false);
    }
  });
});
