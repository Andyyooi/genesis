import Link from "next/link";
import { loadTrackRecord } from "@/track-record/load";

export const dynamic = "force-dynamic";

const percent = (value: number | null) => value === null ? "Not available" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
const price = (value: number) => `RM${value.toFixed(3)}`;

export default function TrackRecordPage() {
  const { dates, latestPicks, summary } = loadTrackRecord();
  return <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
    <header className="space-y-2">
      <p className="section-kicker">FOLLOW THE RESULTS</p>
      <h1 className="text-3xl font-semibold tracking-tight">Track record</h1>
      <p className="text-muted-foreground">How saved top picks have done since they were picked, compared with a basket of big companies.</p>
    </header>
    <div className="market-card space-y-2 p-5 text-sm text-muted-foreground">
      <p>Each refresh saves the default top picks and up to 30 of the largest listed companies by market value with a closing price on the pick date. Each company gets an equal share of its basket.</p>
      <p>Returns use Yahoo adjusted closes on the pick date and latest date when both are available, accounting for splits and provider dividend adjustments. Otherwise, we show price return only from the saved entry price; splits may distort that fallback. Displayed prices remain unadjusted. Fees and trading costs are not included. Prices are not live and may have different dates. This is not a backtest or a promise of future returns.</p>
      <p>Same-date refreshes replace that date’s picks. Averages give each saved date equal weight; they are not a compounded portfolio return. Missing latest prices are left out: {summary.excluded} saved entries excluded.</p>
    </div>
    {!dates.length ? <p className="market-card p-6">Top picks are saved at each refresh; the first results appear after the next refresh.</p> : <>
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Saved pick dates", summary.count], ["Average top-pick return", percent(summary.pickReturn)], ["Average big-company return", percent(summary.basketReturn)], ["Dates ahead of the basket", `${summary.beatCount} of ${summary.comparableCount}`]].map(([label, value]) => <div key={label} className="market-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}
      </section>
      <section className="market-card overflow-hidden">
        <h2 className="p-5 text-lg font-semibold">Results by pick date</h2>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-y bg-muted/40"><tr>{["Pick date", "Top picks", "Big-company basket", "Ahead / behind", "Missing prices"].map((label) => <th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{dates.map((date) => <tr key={date.pickDate} className="border-b last:border-0">
            <td className="px-5 py-4">{date.pickDate}</td><td className="px-5 py-4 tabular-nums">{percent(date.picks.priceReturn)} <span className="text-muted-foreground">({date.picks.count})</span></td><td className="px-5 py-4 tabular-nums">{percent(date.basket.priceReturn)} <span className="text-muted-foreground">({date.basket.count})</span></td>
            <td className="px-5 py-4">{date.difference === null ? "Not available" : `${Math.abs(date.difference * 100).toFixed(2)} percentage points ${date.difference > 0 ? "ahead" : date.difference < 0 ? "behind" : "— level"}`}</td><td className="px-5 py-4">{date.picks.excluded} picks / {date.basket.excluded} basket</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="market-card overflow-hidden">
        <h2 className="p-5 text-lg font-semibold">Latest saved picks · {dates[0].pickDate}</h2>
        {!latestPicks.length ? <p className="px-5 pb-5 text-sm">No top picks had a closing price on this date.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-y bg-muted/40"><tr>{["Rank", "Company", "Entry price", "Latest close", "Price date", "Return"].map((label) => <th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{latestPicks.map((pick) => <tr key={pick.ticker} className="border-b last:border-0"><td className="px-5 py-3">{pick.rank}</td><td className="px-5 py-3"><Link className="underline underline-offset-4" href={`/stock/${encodeURIComponent(pick.ticker)}`}>{pick.ticker}</Link></td><td className="px-5 py-3 tabular-nums">{price(pick.entryClose)}</td><td className="px-5 py-3 tabular-nums">{pick.latestClose === null ? "Not available" : price(pick.latestClose)}</td><td className="px-5 py-3">{pick.latestDate ?? "Not available"}</td><td className="px-5 py-3 tabular-nums">{percent(pick.priceReturn)}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </main>;
}
