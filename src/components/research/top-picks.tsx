import Link from "next/link";
import { Disclosure } from "./disclosure";
import { loadTopPicks, pickReasons, type TopPicksOptions } from "@/opportunities/top-picks";
import { formatScore100 } from "@/lib/research-copy";

export function TopPicks({ options = {}, preservedParams = {} }: { options?: TopPicksOptions; preservedParams?: Record<string, string> }) {
  const { summary, picks, excluded, exclusions, settings } = loadTopPicks(options);
  const money = (value: number) => `RM${value.toLocaleString("en-MY", { notation: "compact", maximumFractionDigits: 1 })}`;
  return <section className="flex flex-col gap-3 rounded-2xl border border-teal-200 bg-gradient-to-br from-white to-teal-50/60 p-5">
    <h2 className="text-xl font-semibold">Top picks right now</h2>
    <p className="text-xs font-medium text-primary">{options.qualityTilt ? "Quality-tilted scores for general companies; published scores for other profiles" : "Published research scores"} · research, not buy/sell advice</p>
    <form action="/" method="get" className="flex flex-wrap items-end gap-4 text-sm">
      {Object.entries(preservedParams).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <label className="flex min-h-10 items-center gap-2"><input type="checkbox" name="qualityTilt" defaultChecked={options.qualityTilt} />Lean towards quality</label>
      <label className="flex flex-col gap-1.5">Max cost per 100-share lot (RM)<input type="number" name="lotBudget" min="0.01" step="0.01" defaultValue={options.lotBudget ?? ""} placeholder="No limit" className="h-10 w-56 rounded-lg border bg-background px-3" /></label>
      <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Update picks</button>
    </form>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">How these are selected</summary><p className="mt-2">Larger companies only: worth at least {money(settings.min_market_cap)}, with at least {money(settings.min_median_traded_value)} traded a day (the median over 60 sessions). They must also pass the published eligibility checks. Lean towards quality gives more weight to quality and a smoother price history, and less to valuation, for general companies only; other profiles keep their published score. A lot budget limits the last closing price × 100, before fees. Leave it blank for no limit. These options only change this list, not the published scores. Factor reasons describe relative blended profile/sector percentiles, not promises of returns or safety. Publication: {summary?.asOf ?? "unavailable"}.</p></details>
    {picks.length ? <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{picks.map((pick, index) => {
      const reasons = pickReasons(pick.result);
      const unavailable = pick.result.categories.flatMap((category) => category.factors).find((factor) => factor.reason?.includes("definition break"));
      return <li className="flex flex-col gap-3 rounded-xl border bg-white p-4" key={pick.ticker}>
        <h3 className="font-semibold">{index + 1}. <Link className="underline underline-offset-4" href={`/stock/${pick.ticker}`}>{pick.ticker} · {pick.name}</Link></h3>
        <p>{pick.qualityTilted ? "Quality-tilted score" : "Published score"} {formatScore100(pick.selectionScore)} · {pick.result.researchProfile}</p>
        <Disclosure title="Evidence & cautions"><ul className="list-inside list-disc text-sm">{reasons.length ? reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No favorable factor percentile is available.</li>}</ul>
        <p className="text-sm">Caution: {unavailable?.reason ?? pick.result.concerns[0]?.message ?? `Data confidence ${pick.result.dataConfidence.level.toLowerCase()}; ${pick.result.dataCoverage.available}/${pick.result.dataCoverage.expected} factors available. Relative rank is not an absolute valuation.`}</p>
        <p className="text-sm text-muted-foreground">Data as of {pick.lastTrade ?? "unavailable"} · accounts {pick.result.dataCoverage.periodEnd ?? "unavailable"}</p></Disclosure>
      </li>;
    })}</ol> : <p className="text-sm text-muted-foreground">{summary ? "No picks meet the company-size, trading-value and selected lot-budget requirements. Try increasing or clearing the lot budget." : "No published picks are available. Use Refresh data to request a new publication."}</p>}
    <p className="text-sm"><Link className="underline" href="/market?eligibility=excluded">{excluded} names excluded by the published eligibility checks</Link>{exclusions.length ? ` — ${exclusions.map(([reason, count]) => `${reason}: ${count}`).join("; ")}. Reasons can overlap.` : "."}</p>
  </section>;
}
