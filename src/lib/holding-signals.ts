import type { ListFairRange } from "@/lib/fair-range-summary";
import type { GoodCompanyPriceDown } from "@/lib/price-drop-flag";

export type HoldingSignal = {
  kind: "below-fair-range" | "price-down";
  title: string;
  why: string;
  date: string | null;
};

/** Current saved conditions, not claims that a threshold was crossed today. */
export function holdingSignals({ range, priceDown, priceDate, inactive = false }: {
  range?: ListFairRange;
  priceDown: GoodCompanyPriceDown | null;
  priceDate: string | null;
  inactive?: boolean;
}): HoldingSignal[] {
  if (inactive) return [];
  const signals: HoldingSignal[] = [];
  if (priceDate && range?.available && range.position === "below") {
    signals.push({
      kind: "below-fair-range",
      title: "Below fair range",
      why: `The saved share price is below the estimated fair range of RM ${range.low.toFixed(3)}–${range.high.toFixed(3)}. The range is an estimate, not a guaranteed price.`,
      date: priceDate,
    });
  }
  if (priceDown) {
    signals.push({
      kind: "price-down",
      title: "Strong company, price down",
      why: `The price is ${Math.round(priceDown.priceDrop.drop * 100)}% below its recent high while the accounts-based checks still rank strongly.${priceDown.results ? ` ${priceDown.results.text}` : ""}`,
      date: priceDown.priceDrop.lastDate,
    });
  }
  return signals;
}
