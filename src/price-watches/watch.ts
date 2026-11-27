import { z } from "zod";
import { validClose, type PricePoint } from "@/lib/price-history";

export const watchTicker = z.string().regex(/^[A-Z0-9._-]{1,32}$/);
const targetRule = z.object({ kind: z.literal("target"), target: z.number().positive().refine((value) => Number(value.toFixed(3)) === value) });
const fairRangeRule = z.object({ kind: z.literal("fair-range") });
export const watchRule = z.discriminatedUnion("kind", [targetRule, fairRangeRule]);

export const savedWatch = z.discriminatedUnion("kind", [
  targetRule.extend({ ticker: watchTicker }),
  fairRangeRule.extend({ ticker: watchTicker, startCloseDate: z.iso.date().nullable() }),
]);

export type PriceWatch = z.infer<typeof savedWatch>;
type Range = { low: number; high: number };

export function evaluatePriceWatch(watch: PriceWatch, latest?: PricePoint, previous?: PricePoint, range?: Range) {
  const close = latest?.close;
  if (!latest || !validClose(close)) return { status: "no-close" } as const;
  if (watch.kind === "target") {
    if (close <= watch.target) return { status: "triggered" } as const;
    return { status: "waiting", direction: "above", percent: (close - watch.target) / watch.target * 100 } as const;
  }

  if (!range) return { status: "no-range" } as const;
  if (close < range.low) return { status: "waiting", direction: "below", percent: (range.low - close) / range.low * 100 } as const;
  if (close > range.high) return { status: "waiting", direction: "above", percent: (close - range.high) / range.high * 100 } as const;

  const prior = previous?.close;
  const afterStart = watch.startCloseDate === null || latest.date > watch.startCloseDate;
  if (afterStart && validClose(prior) && (prior < range.low || prior > range.high)) {
    return { status: "triggered" } as const;
  }
  return { status: "inside" } as const;
}
