import { describe, expect, it } from "vitest";
import { evaluatePriceWatch, watchRule, type PriceWatch } from "@/price-watches/watch";

const ticker = "TEST";
const target: PriceWatch = { ticker, kind: "target", target: 2 };
const fair: PriceWatch = { ticker, kind: "fair-range", startCloseDate: "2026-11-23" };
const range = { low: 2, high: 4 };
const latest = (close: number | null) => ({ date: "2026-11-24", close });
const previous = (close: number | null) => ({ date: "2026-11-23", close });

describe("price watch rules", () => {
  it("checks targets at or below and gives the percent above the target otherwise", () => {
    expect(evaluatePriceWatch(target, latest(2))).toEqual({ status: "triggered" });
    expect(evaluatePriceWatch(target, latest(1.5))).toEqual({ status: "triggered" });
    expect(evaluatePriceWatch(target, latest(2.5))).toEqual({ status: "waiting", direction: "above", percent: 25 });
  });

  it("detects new entry from either side, including either endpoint", () => {
    expect(evaluatePriceWatch(fair, latest(4), previous(6), range)).toEqual({ status: "triggered" });
    expect(evaluatePriceWatch(fair, latest(2), previous(1), range)).toEqual({ status: "triggered" });
    expect(evaluatePriceWatch(fair, latest(1.5), previous(6), range)).toEqual({ status: "waiting", direction: "below", percent: 25 });
    expect(evaluatePriceWatch(fair, latest(5), previous(3), range)).toEqual({ status: "waiting", direction: "above", percent: 25 });
  });

  it("does not trigger for an existing position or for a crossing before the watch was saved", () => {
    expect(evaluatePriceWatch(fair, latest(3), previous(2), range)).toEqual({ status: "inside" });
    expect(evaluatePriceWatch({ ...fair, startCloseDate: "2026-11-24" }, latest(3), previous(1), range)).toEqual({ status: "inside" });
    expect(evaluatePriceWatch(fair, latest(3), undefined, range)).toEqual({ status: "inside" });
  });

  it("keeps missing inputs unavailable instead of triggering", () => {
    expect(evaluatePriceWatch(target)).toEqual({ status: "no-close" });
    expect(evaluatePriceWatch(fair, latest(null), previous(1), range)).toEqual({ status: "no-close" });
    expect(evaluatePriceWatch(fair, latest(3), previous(1))).toEqual({ status: "no-range" });
  });

  it("validates a positive numeric target including half-sen prices", () => {
    expect(watchRule.safeParse({ kind: "target", target: 0.245 }).success).toBe(true);
    for (const invalid of [null, "2.5", 0, -1, 0.0001, Infinity]) {
      expect(watchRule.safeParse({ kind: "target", target: invalid }).success).toBe(false);
    }
  });
});
