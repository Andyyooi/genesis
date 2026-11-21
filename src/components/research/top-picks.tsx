import Link from "next/link";
import { ArrowUpRight, Telescope } from "lucide-react";
import { loadTopPicks, pickReasons } from "@/opportunities/top-picks";
import { formatScore100 } from "@/lib/research-copy";

export function TopPicks() {
  const { summary, picks, excluded, exclusions } = loadTopPicks();
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
        Highest eligible published research scores. A starting point, not a buy
        list.
      </p>
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
                  </div>
                  <span className="radar-score">
                    {pick.result.researchScore?.toFixed(0) ?? "—"}
                    <small>/100</small>
                  </span>
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-primary">
                    Evidence & cautions
                  </summary>
                  <p className="mt-2 font-medium">
                    Research {formatScore100(pick.result.researchScore)} ·{" "}
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
          No eligible published candidates. Check data reports or request a
          manual refresh.
        </p>
      )}
      <details className="border-t px-5 py-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Selection & publication details
        </summary>
        <p className="mt-2">
          Highest eligible published scores, not personalised advice.
          Publication: {summary?.asOf ?? "unavailable"}.
        </p>
        <Link
          className="mt-2 inline-block text-primary underline"
          href="/market?eligibility=excluded"
        >
          {excluded} names excluded from recommendations
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
