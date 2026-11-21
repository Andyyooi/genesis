import Link from "next/link";
import { ArrowUpRight, Telescope } from "lucide-react";
import { loadTopPicks, pickReasons, type TopPicksOptions } from "@/opportunities/top-picks";
import { formatScore100 } from "@/lib/research-copy";

export function TopPicks({ options = {}, preservedParams = {} }: { options?: TopPicksOptions; preservedParams?: Record<string, string> }) {
  const { summary, picks, excluded, exclusions, settings } = loadTopPicks(options);
  const money = (value: number) => `RM${value.toLocaleString("en-MY", { notation: "compact", maximumFractionDigits: 1 })}`;
  return (
    <section className="market-card overflow-hidden">
      <div className="radar-heading">
        <span className="radar-icon">
          <Telescope className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="section-kicker">DISCOVER & INVESTIGATE</p>
          <h2 className="text-lg font-semibold">Research radar</h2>
        </div>
      </div>
      <p className="px-5 pb-3 text-xs text-muted-foreground">
        {options.qualityTilt ? "Quality-tilted scores for general companies; published scores for other profiles." : "Highest eligible published research scores."} A starting point, not a buy list.
      </p>
      <form action="/" method="get" className="flex flex-col gap-3 px-5 pb-4 text-xs">
        {Object.entries(preservedParams).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="flex items-center gap-2"><input type="checkbox" name="qualityTilt" defaultChecked={options.qualityTilt} />Lean towards quality</label>
        <label className="flex flex-col gap-1.5">Max cost per 100-share lot (RM)<input type="number" name="lotBudget" min="0.01" step="0.01" defaultValue={options.lotBudget ?? ""} placeholder="No limit" className="h-9 w-full min-w-0 rounded-lg border bg-background px-3" /></label>
        <button type="submit" className="self-start rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground">Update picks</button>
      </form>
      {picks.length ? (
        <ol className="radar-list">
          {picks.slice(0, 3).map((pick, index) => {
            const reasons = pickReasons(pick.result);
            const unavailable = pick.result.categories
              .flatMap((category) => category.factors)
              .find((factor) => factor.reason?.includes("definition break"));
            return (
              <li key={pick.ticker}>
                <div className="flex items-start gap-3">
                  <span className="radar-rank">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/stock/${pick.ticker}`}
                      className="company-symbol"
                    >
                      {pick.ticker}
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={pick.name}
                    >
                      {pick.name}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{pick.qualityTilted ? "Quality-tilted score" : "Published score"}</p>
                  </div>
                  <span className="radar-score">
                    {pick.selectionScore?.toFixed(0) ?? "—"}
                    <small>/100</small>
                  </span>
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-primary">
                    Evidence & cautions
                  </summary>
                  <p className="mt-2 font-medium">
                    {pick.qualityTilted ? "Quality-tilted score" : "Published score"} {formatScore100(pick.selectionScore)} ·{" "}
                    {pick.result.researchProfile}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {reasons.length ? (
                      reasons.map((reason) => <li key={reason}>{reason}</li>)
                    ) : (
                      <li>No favourable factor percentile is available.</li>
                    )}
                  </ul>
                  <p className="mt-2 text-amber-800">
                    {unavailable?.reason ??
                      pick.result.concerns[0]?.message ??
                      `Data confidence ${pick.result.dataConfidence.level.toLowerCase()}; ${pick.result.dataCoverage.available}/${pick.result.dataCoverage.expected} factors available.`}
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    Price {pick.lastTrade ?? "unavailable"} · accounts{" "}
                    {pick.result.dataCoverage.periodEnd ?? "unavailable"}.
                    Relative rank is not absolute value.
                  </p>
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          {summary ? "No picks meet the company-size, trading-value and selected lot-budget requirements. Try increasing or clearing the lot budget." : "No published picks are available. Check data reports or request a manual refresh."}
        </p>
      )}
      <details className="border-t px-5 py-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          How these are selected
        </summary>
        <p className="mt-2">
          Larger companies only: worth at least {money(settings.min_market_cap)}, with at least {money(settings.min_median_traded_value)} traded a day (the median over 60 sessions). They must also pass the published eligibility checks. Lean towards quality gives more weight to quality and a smoother price history, and less to valuation, for general companies only; other profiles keep their published score. A lot budget limits the last closing price × 100, before fees. Leave it blank for no limit. These options only change this list, not the published scores. Factor reasons describe relative blended profile/sector percentiles, not promises of returns or safety. Publication: {summary?.asOf ?? "unavailable"}.
        </p>
        <Link
          className="mt-2 inline-block text-primary underline"
          href="/market?eligibility=excluded"
        >
          {excluded} names excluded by the published eligibility checks
        </Link>
        {exclusions.length ? (
          <ul className="mt-2 space-y-1">
            {exclusions.map(([reason, count]) => (
              <li key={reason}>
                {reason}: {count}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2">Reasons can overlap.</p>
      </details>
      <Link href="/market?eligibility=eligible" className="radar-footer">
        Explore eligible research{" "}
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
