import { CircleAlert, CircleCheck } from "lucide-react";
import {
  OLD_NEWEST_PRICE_DAYS,
  PRICE_JUMP_MIN_RM,
  PRICE_JUMP_PERCENT,
  RECENT_MARKET_DAYS,
  priceCheckIssueCount,
  priceNewestTooOld,
  type PriceCheckReport,
} from "@/refresh/price-check";

const rm = (value: number) => `RM${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

function Finding({ title, explain, items }: { title: string; explain: string; items: string[] }) {
  return (
    <details className="border-b border-[#f0f3f5] py-2 text-xs">
      <summary className="flex cursor-pointer justify-between gap-3 text-amber-900">
        <span>{title}</span>
        <strong className="tabular-nums">{items.length}</strong>
      </summary>
      <p className="mt-2 text-muted-foreground">{explain}</p>
      <ul className="mt-2 flex flex-col gap-1 break-words">
        {items.slice(0, 25).map((item) => <li key={item}>{item}</li>)}
        {items.length > 25 ? <li className="text-muted-foreground">…and {items.length - 25} more</li> : null}
      </ul>
    </details>
  );
}

export function PriceCheckCard({ report, fromRefresh }: { report: PriceCheckReport; fromRefresh: boolean }) {
  const issues = priceCheckIssueCount(report);
  const tooOld = priceNewestTooOld(report);
  const ok = issues === 0 && !tooOld;
  const when = fromRefresh
    ? `Checked after the last Refresh data run (${report.checkedAt.slice(0, 10)}).`
    : "Checked on the published prices; the next Refresh data run saves its own check.";
  return (
    <section className={`market-card border-l-4 p-5 ${ok ? "border-l-emerald-600" : "border-l-amber-500"}`} aria-label="Price check">
      <div className="mb-2 flex items-center gap-2">
        {ok
          ? <CircleCheck className="size-4 text-emerald-700" aria-hidden="true" />
          : <CircleAlert className="size-4 text-amber-700" aria-hidden="true" />}
        <h2 className="font-semibold">Price check</h2>
      </div>
      <p className={`text-sm ${ok ? "text-emerald-800" : "text-amber-900"}`}>
        {ok
          ? `All ${report.listed.toLocaleString("en-MY")} stocks have a price for ${report.newestDate ?? "the latest day"} with no odd jumps.`
          : `${issues.toLocaleString("en-MY")} of ${report.listed.toLocaleString("en-MY")} stocks have a missing, old or odd price. Check these names before relying on their picks.`}
      </p>
      {tooOld ? (
        <p className="mt-2 text-sm font-medium text-amber-900">
          The newest price is from {report.newestDate}, {report.newestDaysOld} days before the refresh. Yahoo may not have sent new prices.
        </p>
      ) : null}
      <div className="mt-2">
        {report.failedThisRun.length ? (
          <Finding title="Not downloaded this refresh" explain="Yahoo sent nothing for these stocks this time. Their older saved prices are kept." items={report.failedThisRun} />
        ) : null}
        {report.noPrice.length ? (
          <Finding title="No price at all" explain="There is no saved price for these stocks, so they cannot be valued." items={report.noPrice.map((s) => `${s.ticker} · ${s.name}`)} />
        ) : null}
        {report.stale.length ? (
          <Finding title={`Last price older than ${report.newestDate}`} explain="These stocks did not get the newest day's price. They may be suspended, rarely traded, or Yahoo may have missed them." items={report.stale.map((s) => `${s.ticker} · last price ${s.lastDate}`)} />
        ) : null}
        {report.jumps.length ? (
          <Finding
            title={`Price moved ${PRICE_JUMP_PERCENT}% or more in a day`}
            explain={`Checked over the last ${RECENT_MARKET_DAYS} trading days. Moves smaller than ${rm(PRICE_JUMP_MIN_RM)} are ignored. A big move can be real news, a share split or a Yahoo error, so compare with another source.`}
            items={report.jumps.map((s) => `${s.ticker} · ${s.date}: ${rm(s.from)} → ${rm(s.to)} (${s.changePercent > 0 ? "+" : ""}${s.changePercent}%)`)}
          />
        ) : null}
      </div>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">How this check works</summary>
        <p className="mt-2">
          {when} It flags stocks with no saved price, a last price older than the newest day, or a day-to-day move of {PRICE_JUMP_PERCENT}% or more
          (and at least {rm(PRICE_JUMP_MIN_RM)}). It also warns when the newest price is more than {OLD_NEWEST_PRICE_DAYS} days older than the refresh. Prices are never changed by this check.
        </p>
      </details>
    </section>
  );
}
