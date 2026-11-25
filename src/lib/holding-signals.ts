import type { ListFairRange } from "@/lib/fair-range-summary";
import type { GoodCompanyPriceDown } from "@/lib/price-drop-flag";
import { latestQuarterlyResultAlert } from "@/lib/quarterly-results";
import type { StatementSnapshot } from "@/metrics/types";

export type HoldingSignal = {
  kind: "new-results" | "below-fair-range" | "price-down";
  title: string;
  why: string;
  date: string | null;
};

/** Current saved conditions, not claims that a threshold was crossed today. */
export function holdingSignals({ range, priceDown, priceDate, periods = [], inactive = false }: {
  range?: ListFairRange;
  priceDown: GoodCompanyPriceDown | null;
  priceDate: string | null;
  periods?: StatementSnapshot[];
  inactive?: boolean;
}): HoldingSignal[] {
  if (inactive) return [];
  const signals: HoldingSignal[] = [];
  const results = latestQuarterlyResultAlert(periods, priceDate);
  if (results) {
    signals.push({
      kind: "new-results",
      title: "New quarterly results",
      why: results.summary,
      date: results.reportedDate ?? results.periodEnd,
    });
  }
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
