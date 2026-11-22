import { formatDateSafe } from "@/lib/display";
import { formatSharePrice } from "@/lib/format-myr";
import type { GoodCompanyPriceDown, ResultsComparison } from "@/lib/price-drop-flag";

export function LatestResultsLine({ results }: { results: ResultsComparison | null }) {
  if (!results) return null;
  return (
    <p className={`text-sm ${results.tone === "weaker" ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
      {results.text}
    </p>
  );
}

export function GoodCompanyPriceDownCard({ flag }: { flag: GoodCompanyPriceDown }) {
  const { priceDrop, scores, results } = flag;
  const scoreText = scores.map((s) => `${s.label} ${s.score.toFixed(0)}/100`).join(" and ");
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950/40">
      <h2 className="font-semibold">Strong company, price down sharply</h2>
      <p className="mt-1">
        The price is {Math.round(priceDrop.drop * 100)}% below its highest close in the last 3 months (
        {formatSharePrice(priceDrop.highClose)} on {formatDateSafe(priceDrop.highDate)}, now{" "}
        {formatSharePrice(priceDrop.lastClose)}), while the scores from its accounts still rank strongly: {scoreText}.
      </p>
      {results ? <div className="mt-2"><LatestResultsLine results={results} /></div> : null}
      <p className="mt-2 text-muted-foreground">
        A prompt to look closer, not a buy signal. A price that drops on bad results can keep dropping, so check the
        latest results and news before deciding. The account scores use the last annual report, which may not yet show
        what caused the fall.
      </p>
    </section>
  );
}
