import Link from "next/link";
import { Disclosure } from "./disclosure";
import { loadTopPicks, pickReasons } from "@/opportunities/top-picks";
import { formatScore100 } from "@/lib/research-copy";

export function TopPicks() {
  const { summary, picks, excluded, exclusions } = loadTopPicks();
  if (!picks.length) return <Disclosure title="Top picks" hint="No eligible published picks available.">
    <p className="text-sm text-muted-foreground">Use Refresh data to request a new publication. These are research lists, not buy or sell instructions.</p>
    <p className="text-sm">Publication: {summary?.asOf ?? "Unavailable"}. <Link href="/market?eligibility=excluded" className="text-primary underline">{excluded} names excluded</Link>.</p>
    {exclusions.length ? <ul className="list-inside list-disc text-sm">{exclusions.map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul> : null}
  </Disclosure>;
  return <section className="flex flex-col gap-3 rounded-2xl border border-teal-200 bg-gradient-to-br from-white to-teal-50/60 p-5">
    <h2 className="text-xl font-semibold">Top picks right now</h2>
    <p className="text-xs font-medium text-primary">Eligible published scores · research, not buy/sell advice</p>
    <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">How these are selected</summary><p className="mt-2">Highest eligible published scores, not personalised advice. Factor reasons describe relative blended profile/sector percentiles, not promises of returns. Publication: {summary?.asOf ?? "unavailable"}.</p></details>
    {picks.length ? <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{picks.map((pick, index) => {
      const reasons = pickReasons(pick.result);
      const unavailable = pick.result.categories.flatMap((category) => category.factors).find((factor) => factor.reason?.includes("definition break"));
      return <li className="flex flex-col gap-3 rounded-xl border bg-white p-4" key={pick.ticker}>
        <h3 className="font-semibold">{index + 1}. <Link className="underline underline-offset-4" href={`/stock/${pick.ticker}`}>{pick.ticker} · {pick.name}</Link></h3>
        <p>Score {formatScore100(pick.result.researchScore)} · {pick.result.researchProfile}</p>
        <Disclosure title="Evidence & cautions"><ul className="list-inside list-disc text-sm">{reasons.length ? reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No favorable factor percentile is available.</li>}</ul>
        <p className="text-sm">Caution: {unavailable?.reason ?? pick.result.concerns[0]?.message ?? `Data confidence ${pick.result.dataConfidence.level.toLowerCase()}; ${pick.result.dataCoverage.available}/${pick.result.dataCoverage.expected} factors available. Relative rank is not an absolute valuation.`}</p>
        <p className="text-sm text-muted-foreground">Data as of {pick.lastTrade ?? "unavailable"} · accounts {pick.result.dataCoverage.periodEnd ?? "unavailable"}</p></Disclosure>
      </li>;
    })}</ol> : <p>No eligible published picks are available. Use Refresh data to request a new publication.</p>}
    <p className="text-sm"><Link className="underline" href="/market?eligibility=excluded">{excluded} names excluded from recommendations</Link>{exclusions.length ? ` — ${exclusions.map(([reason, count]) => `${reason}: ${count}`).join("; ")}. Reasons can overlap.` : "."}</p>
  </section>;
}
