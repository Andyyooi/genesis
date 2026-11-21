import Link from "next/link";
import { loadTopPicks, pickReasons } from "@/opportunities/top-picks";
import { formatScore100 } from "@/lib/research-copy";

export function TopPicks() {
  const { summary, picks, excluded, exclusions } = loadTopPicks();
  return <section className="flex flex-col gap-4 rounded-lg border p-4">
    <h2 className="text-2xl font-semibold">Top picks right now</h2>
    <p className="rounded-md border-2 p-3 font-semibold">Research, not a buy/sell instruction</p>
    <p className="text-sm text-muted-foreground">Highest eligible published scores, not personalised advice. Factor reasons describe relative blended profile/sector percentiles, not promises of returns. Publication: {summary?.asOf ?? "unavailable"}.</p>
    {picks.length ? <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{picks.map((pick, index) => {
      const reasons = pickReasons(pick.result);
      const unavailable = pick.result.categories.flatMap((category) => category.factors).find((factor) => factor.reason?.includes("definition break"));
      return <li className="flex flex-col gap-2 rounded-md border p-3" key={pick.ticker}>
        <h3 className="font-semibold">{index + 1}. <Link className="underline underline-offset-4" href={`/stock/${pick.ticker}`}>{pick.ticker} · {pick.name}</Link></h3>
        <p>Score {formatScore100(pick.result.researchScore)} · {pick.result.researchProfile}</p>
        <ul className="list-inside list-disc text-sm">{reasons.length ? reasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No favorable factor percentile is available.</li>}</ul>
        <p className="text-sm">Caution: {unavailable?.reason ?? pick.result.concerns[0]?.message ?? `Data confidence ${pick.result.dataConfidence.level.toLowerCase()}; ${pick.result.dataCoverage.available}/${pick.result.dataCoverage.expected} factors available. Relative rank is not an absolute valuation.`}</p>
        <p className="text-sm text-muted-foreground">Data as of {pick.lastTrade ?? "unavailable"} · accounts {pick.result.dataCoverage.periodEnd ?? "unavailable"}</p>
      </li>;
    })}</ol> : <p>No eligible published picks are available. Use Refresh data to request a new publication.</p>}
    <p className="text-sm"><Link className="underline" href="/market?eligibility=excluded">{excluded} names excluded from recommendations</Link>{exclusions.length ? ` — ${exclusions.map(([reason, count]) => `${reason}: ${count}`).join("; ")}. Reasons can overlap.` : "."}</p>
  </section>;
}
