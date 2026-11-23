import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  FileCheck2,
  ShieldAlert,
} from "lucide-react";
import { Disclosure } from "@/components/research/disclosure";
import { MarketResults } from "@/components/research/market-results";
import { loadLatestFundamentalsQuality } from "@/market/fundamentals-quality";
import { loadLatestMarketScan } from "@/market/scan";
import { filterMarketRows } from "@/market/filters";
import { toMarketResultRow, visibleFairRanges } from "@/market/result-props";
import { formatScore100 } from "@/lib/research-copy";
import { loadMarketScanFairRanges } from "@/fair-value/load-list-ranges";
import { buyScoreValue } from "@/lib/buy-score";
import { publishedBuyScore } from "@/scoring/published-research-scores";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  searchParams,
}: PageProps<"/market">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const eligibility =
    params.eligibility === "eligible" || params.eligibility === "excluded"
      ? params.eligibility
      : "";
  const { summary, rows } = loadLatestMarketScan();
  const belowFairRange = params.fair === "below";
  const fairRanges = loadMarketScanFairRanges(rows.map(row => String(row.ticker)));
  const visible = filterMarketRows(rows, q, eligibility, { belowFairRange, fairRanges }).map((row) =>
    toMarketResultRow(row, buyScoreValue(publishedBuyScore({
      researchScore: typeof row.researchScore === "number" ? row.researchScore : null,
      eligible: row.eligible === true,
      needsVerification: row.needsVerification === true,
    }))),
  );
  const quality = loadLatestFundamentalsQuality();
  const dq = summary?.dataQuality;

  return (
    <main className="scan-page mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-7 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker mb-2">
            BURSA MALAYSIA / MARKET EXPLORER
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Market scan
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A wider view. Find companies worth a closer look.
          </p>
        </div>
        <span className="snapshot-chip">
          <span />
          Scan · {summary?.asOf.slice(0, 10) ?? "unavailable"}
        </span>
      </header>
      {!summary ? (
        <section className="market-card p-6">
          <h2 className="font-semibold">No published scan yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The market scan will appear when the next data update is published.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm text-primary underline"
          >
            Back to overview
          </Link>
        </section>
      ) : (
        <>
          <section
            className="pulse-grid scan-stats"
            aria-label="Market coverage summary"
          >
            <Stat
              label="Listed names"
              value={dq?.instruments}
              icon={<Building2 size={16} />}
              note="Stocks & REITs"
            />
            <Stat
              label="With prices"
              value={dq?.withPrices}
              icon={<ChartNoAxesCombined size={16} />}
              note="Saved market data"
            />
            <Stat
              label="With fundamentals"
              value={dq?.withFundamentals}
              icon={<FileCheck2 size={16} />}
              note="Accounts available"
            />
            <Stat
              label="Needs verification"
              value={summary.scores.needsVerification ?? 0}
              icon={<ShieldAlert size={16} />}
              note="Review before relying on scores"
              caution
            />
          </section>
          <div className="scan-context-grid">
            <Disclosure title="Market data quality">
              <p className="text-sm text-muted-foreground">
                {summary.scores.insufficient} names have insufficient data ·{" "}
                {dq?.reits ?? 0} REITs · {dq?.pn17 ?? 0} PN17 names. Scan saved{" "}
                {summary.asOf.slice(0, 19).replace("T", " ")}.
              </p>
              <p className="text-sm text-muted-foreground">
                Price misses: {summary.prices.failed} · Financial statement
                misses: {summary.fundamentalsYahoo.failed}.
              </p>
              {quality ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Latest annual accounts per listed company. Full coverage
                    includes revenue, profit after tax and equity. Account age
                    uses the reporting period or filing date, not download time.
                  </p>
                  <dl className="scan-quality-stats">
                    <div>
                      <dt>Usable</dt>
                      <dd>{quality.coverage.usable}</dd>
                    </div>
                    <div>
                      <dt>Full</dt>
                      <dd>{quality.coverage.full}</dd>
                    </div>
                    <div>
                      <dt>Partial</dt>
                      <dd>{quality.coverage.partial}</dd>
                    </div>
                    <div>
                      <dt>None</dt>
                      <dd>{quality.coverage.none}</dd>
                    </div>
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    Fresh {quality.freshness.FRESH ?? 0} · aging{" "}
                    {quality.freshness.AGING ?? 0} · stale{" "}
                    {quality.freshness.STALE ?? 0} · very stale{" "}
                    {quality.freshness.VERY_STALE ?? 0} · no period{" "}
                    {quality.freshness.NONE ?? 0}.
                  </p>
                  {quality.failures.length ? (
                    <ul className="text-sm text-muted-foreground">
                      {quality.failures.map((row) => (
                        <li key={row.code}>
                          {row.code}: {row.count}
                          {row.examples.length
                            ? ` (e.g. ${row.examples.slice(0, 4).join(", ")})`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No fundamentals failures recorded.
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Data source limitations: {quality.yahooCannot.join("; ")}.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No fundamentals quality report has been published yet.
                </p>
              )}
            </Disclosure>
            <Disclosure title="Market highlights">
              <ScanHighlights
                title="Highest research scores"
                rows={(summary.highlights.highestResearch ?? []).map((r) => ({
                  ticker: r.ticker,
                  extra: `${formatScore100(r.score)} · ${r.confidence ?? ""}`,
                }))}
              />
              <ScanHighlights
                title="Highest valuation scores"
                rows={(summary.highlights.highestValuation ?? []).map((r) => ({
                  ticker: r.ticker,
                  extra: `${formatScore100(r.score)} · ${r.confidence ?? ""}`,
                }))}
              />
              <ScanHighlights
                title="High scores needing verification"
                rows={(summary.highlights.needsVerification ?? []).map((r) => ({
                  ticker: r.ticker,
                  extra: `${formatScore100(r.score)} · ${r.confidence ?? ""} · ${String(r.freshness ?? "").replaceAll("_", " ")}`,
                }))}
              />
              <ScanHighlights
                title="At least 15% below the 52-week high"
                rows={summary.highlights.largeMoves.map((r) => ({
                  ticker: r.ticker,
                  extra:
                    r.distanceFrom52wHigh == null
                      ? "Data unavailable"
                      : `${(r.distanceFrom52wHigh * 100).toFixed(0)}% below high`,
                }))}
              />
              <ScanHighlights
                title="Insufficient data — sample"
                rows={summary.highlights.insufficientData.map((ticker) => ({
                  ticker,
                  extra: "Coverage too thin or no research score",
                }))}
              />
            </Disclosure>
          </div>
          <MarketResults
            fairRanges={visibleFairRanges(visible, fairRanges)}
            belowFairRange={belowFairRange}
            rows={visible}
            total={rows.length}
            query={q}
            eligibility={eligibility}
            requestedPage={typeof params.page === "string" ? params.page : "1"}
          />
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  icon,
  note,
  caution,
}: {
  label: string;
  value?: number;
  icon: React.ReactNode;
  note: string;
  caution?: boolean;
}) {
  return (
    <div className={`pulse-card${caution ? " scan-stat-caution" : ""}`}>
      <div className="pulse-label">
        <span>{label}</span>
        <span aria-hidden="true">{icon}</span>
      </div>
      <p className="pulse-number">{value?.toLocaleString("en-MY") ?? "—"}</p>
      <p className="scan-stat-note">{note}</p>
    </div>
  );
}

function ScanHighlights({
  title,
  rows,
}: {
  title: string;
  rows: { ticker: string; extra: string }[];
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length ? (
        <ul className="scan-highlights">
          {rows.map((row) => (
            <li key={row.ticker}>
              <Link href={`/stock/${row.ticker}`} className="company-symbol">
                {row.ticker}
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
              <span>{row.extra}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None in this snapshot.</p>
      )}
    </section>
  );
}
