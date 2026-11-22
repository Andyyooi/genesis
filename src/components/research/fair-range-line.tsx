import { formatSharePrice } from "@/lib/format-myr";
import { FAIR_RANGE_POSITION_TEXT, type FairRangeHeadline } from "@/lib/fair-range";

/** Estimates to the nearest half sen; more digits would suggest false precision. */
function estimate(value: number): string {
  return formatSharePrice(Math.max(0.005, Math.round(value * 200) / 200));
}

export function FairRangeLine({ range }: { range: FairRangeHeadline }) {
  if (!range.available) {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm">
        <p className="font-medium">Fair range: not available</p>
        <p className="text-muted-foreground">{range.reason}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm">
      <p className="text-lg font-semibold tabular-nums">
        Fair range {estimate(range.low)} to {estimate(range.high)}
        {range.price == null ? "" : `, now ${formatSharePrice(range.price)}`}
      </p>
      {range.position ? <p>{FAIR_RANGE_POSITION_TEXT[range.position]}</p> : null}
      <p className="text-muted-foreground">
        Middle estimate {estimate(range.middle)}. Worked out from what similar companies, and this company in past years, trade at against profits, book value and dividends ({range.methodCount} methods). An estimate to compare against, not a promise the price will get there.
      </p>
      {range.wideSpread ? (
        <p className="text-amber-800 dark:text-amber-300">
          The methods disagree a lot for this stock, so treat the range as rough. See “Fair value” below for each method.
        </p>
      ) : null}
      {range.caution ? (
        <p className="text-amber-800 dark:text-amber-300">Some valuation checks raised cautions; see “Fair value” below.</p>
      ) : null}
    </div>
  );
}
