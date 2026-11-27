import { z } from "zod";
import { roundFairEstimate } from "@/lib/format-myr";
import { validClose, type PricePoint } from "@/lib/price-history";

export const watchTicker = z.string().regex(/^[A-Z0-9._-]{1,32}$/);
const pricePrecision = (value: number) => Number(value.toFixed(3));
const targetRule = z.object({ kind: z.literal("target"), target: z.number().positive().refine((value) => pricePrecision(value) === value) });
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
  const quotedClose = pricePrecision(close);
  if (watch.kind === "target") {
    if (quotedClose <= watch.target) return { status: "triggered" } as const;
    return { status: "waiting", direction: "above", percent: (quotedClose - watch.target) / watch.target * 100 } as const;
  }

  if (!range) return { status: "no-range" } as const;
  const low = roundFairEstimate(range.low);
  const high = roundFairEstimate(range.high);
  if (quotedClose < low) return { status: "waiting", direction: "below", percent: (low - quotedClose) / low * 100 } as const;
  if (quotedClose > high) return { status: "waiting", direction: "above", percent: (quotedClose - high) / high * 100 } as const;

  const prior = validClose(previous?.close) ? pricePrecision(previous.close) : null;
  const afterStart = watch.startCloseDate === null || latest.date > watch.startCloseDate;
  if (afterStart && prior !== null && (prior < low || prior > high)) {
    return { status: "triggered" } as const;
  }
  return { status: "inside" } as const;
}
