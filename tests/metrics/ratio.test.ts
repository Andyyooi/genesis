import { describe, expect, it } from "vitest";
import { safeDivide } from "@/metrics/ratio";

describe("safeDivide", () => {
  it("returns unavailable when a side is missing (not zero)", () => {
    const result = safeDivide("x", "X", null, 10, "a/b", [], "2024-12-31");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/Numerator is unavailable/);
  });

  it("returns unavailable on division by zero", () => {
    const result = safeDivide("x", "X", 5, 0, "a/b", [], "2024-12-31");
    expect(result.available).toBe(false);
    expect(result.value).toBeNull();
    expect(result.reason).toBe("Division by zero");
  });

  it("divides when both sides exist", () => {
    const result = safeDivide("x", "X", 10, 4, "a/b", [], "2024-12-31");
    expect(result.available).toBe(true);
    expect(result.value).toBe(2.5);
    expect(result.period).toBe("2024-12-31");
  });
});
