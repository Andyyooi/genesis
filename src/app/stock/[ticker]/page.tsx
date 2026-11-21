import { Disclosure } from "@/components/research/disclosure";
import { FinancialTerm } from "@/components/research/financial-term";
import { plainConcern } from "@/lib/financial-terms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryDisclosure } from "@/components/research/category-disclosure";
import {
  DataQualitySection,
  ResearchScoreCard,
  ScoreWithConfidence,
} from "@/components/research/data-confidence";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { ExportActions } from "@/components/research/export-actions";
import { ValuationContextCard } from "@/components/research/valuation-context";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadScoreHistory } from "@/db/queries";
import type { LineItems } from "@/ingest/types";
import { formatDateSafe } from "@/lib/display";
import { formatMetricValue } from "@/lib/format-metric";
import { formatMyr } from "@/lib/format-myr";
import {
  absoluteValuationBlurb,
  researchInterpretationBullets,
} from "@/lib/research-presentation";
import { buildSnapshotDates, latestAnnualPeriod } from "@/lib/snapshot-dates";
import type { MetricValue } from "@/metrics/types";
import { PersistedFairValue } from "@/components/research/persisted-fair-value";
import { loadPersistedFairValueForPage } from "@/fair-value/load-persisted-page";
import { scoreTicker } from "@/scoring/run-ticker";
import { PriceChart } from "@/components/research/price-chart";
import { loadSavedPrices } from "@/db/price-history";

export const dynamic = "force-dynamic";

function parseLineItems(json: string | null): LineItems | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LineItems;
  } catch {
    return null;
  }
}

function metricById(metrics: MetricValue[], id: string): MetricValue | undefined {
  return metrics.find((m) => m.id === id);
}

function sma(closesNewestFirst: number[], window: number): number | null {
  if (closesNewestFirst.length < window) return null;
  const slice = closesNewestFirst.slice(0, window);
  return slice.reduce((sum, n) => sum + n, 0) / window;
}

function fmtRatio(metric: MetricValue | undefined): string {
  if (!metric) return "Unavailable";
  return formatMetricValue(metric);
}

function profileMetricIds(profile: string, isReit: boolean): string[] {
  if (isReit || profile === "REIT") {
    return [
      "dividend_yield",
      "book_nav_premium",
      "nav_per_share",
      "dpu_cagr",
      "reit_gearing",
      "occupancy",
      "wale_years",
      "npi",
      "reit_interest_coverage",
      "revenue_cagr",
    ];
  }
  if (profile === "BANK") {
    return [
      "price_to_book",
      "dividend_yield",
      "roe",
      "nim",
      "cost_to_income",
      "impaired_loans_ratio",
      "cet1_ratio",
      "revenue_cagr",
      "pat_cagr",
    ];
  }
  return [
    "price_to_earnings",
    "dividend_yield",
    "price_to_book",
    "roe",
    "net_margin",
    "debt_to_equity",
    "fcf",
    "net_debt_to_ebitda",
    "revenue_cagr",
    "pat_cagr",
  ];
}

function MetricTable({ ids, metrics }: { ids: string[]; metrics: MetricValue[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Metric</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="hidden sm:table-cell">Period</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ids.map((id) => {
          const metric = metricById(metrics, id);
          return (
            <TableRow key={id}>
              <TableCell><FinancialTerm id={id} fallback={metric?.label} /></TableCell>
              <TableCell className="whitespace-normal text-right">{fmtRatio(metric)}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {metric?.period ? formatDateSafe(metric.period) : "Unavailable"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default async function ResearchPage({
  params,
}: PageProps<"/stock/[ticker]">) {
  const { ticker } = await params;
  const scored = scoreTicker(ticker);
  if (!scored) notFound();

  const { instrument, periods, bars, metrics, result } = scored;
  const history = loadScoreHistory(instrument.id, 8);
  const lastClose = metricById(metrics, "last_close");
  const lastTrade = metricById(metrics, "last_trade_date");
  const snapshotDates = buildSnapshotDates({
    scoreAsOf: result.asOf,
    lastTradeDate: lastTrade?.period ?? null,
    fundamentalsPeriod: latestAnnualPeriod(periods),
  });
  const annuals = periods.filter((p) => p.statementType === "annual").slice(0, 6);
  const closes = bars.map((b) => b.close).filter((n): n is number => n !== null);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const lastVolume = bars[0]?.volume ?? null;
  const isReit = scored.instrumentType === "REIT";
  const isBank = result.researchProfile === "BANK" || result.profile === "bank";
  const instrumentLabel = isReit ? "REIT" : "Common stock";
  const interpretation = researchInterpretationBullets({
    result,
    metrics,
    events: scored.events,
  });
  const profileIds = profileMetricIds(result.researchProfile, isReit);
  const fairValue = loadPersistedFairValueForPage(instrument.id);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="text-foreground underline underline-offset-4">
          Dashboard
        </Link>
      </p>

      {/* A. Header */}
      <header className="flex flex-col gap-3 border-b pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{instrument.name}</h1>
          <Badge variant={isReit ? "secondary" : "outline"}>{instrumentLabel}</Badge>
          <Badge variant="outline">{result.researchProfile}</Badge>
          {instrument.pn17 ? <Badge variant="destructive">Financial distress warning (PN17)</Badge> : null}
          {instrument.shariahCompliant === true ? (
            <Badge variant="secondary">Shariah</Badge>
          ) : null}
          {instrument.listingBoard ? (
            <Badge variant="outline">{instrument.listingBoard}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          {instrument.ticker}
          {instrument.bursaCode ? ` · Bursa ${instrument.bursaCode}` : ""}
          {instrument.sector ? ` · ${instrument.sector}` : ""}
          {instrument.industry ? ` · ${instrument.industry}` : ""}
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Last close (RM)</dt>
            <dd className="text-lg font-medium tabular-nums">{fmtRatio(lastClose)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Price date</dt>
            <dd className="font-medium">{formatDateSafe(lastTrade?.period)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last research run</dt>
            <dd className="font-medium">{formatDateSafe(result.asOf)}</dd>
          </div>
        </dl>
        <DataLagBanner dates={snapshotDates} />
        {isReit ? (
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer text-primary">About property-fund (REIT) research</summary><p className="mt-2">Property funds are compared using cash payments to investors, net property assets, growth in payments and borrowing. Ordinary-company cash-flow and operating-earnings comparisons are not used.
          </p></details>
        ) : null}
        {isBank ? (
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer text-primary">About bank research</summary><p className="mt-2">Banks are compared using price versus net assets (P/B), profit on shareholders’ money (ROE), and bank health checks where data exists. Ordinary-company cash-flow and operating-earnings comparisons are not used.
          </p></details>
        ) : null}
      </header>

      <PriceChart ticker={instrument.ticker} points={loadSavedPrices(instrument.ticker, -1)} />

      {/* B. Research Score Card */}
      <ResearchScoreCard result={result} />

      {/* C. Score breakdown */}
      <Disclosure title="Score breakdown" hint="See the financial and price checks (factors) behind this score.">
        <div>
          <p className="text-sm text-muted-foreground">
            Each factor is one financial or price check. Higher scores mean a stronger comparison with other scored companies, not a guaranteed return. A live weight is how much a category counts in this result. Missing checks are left out, not scored as zero; the remaining categories share the weight.
          </p>
        </div>
        <CategoryDisclosure categories={result.categories} />
      </Disclosure>

      {/* 3. Data Quality */}
      <DataQualitySection result={result} />

      {/* 4. Research interpretation */}
      <Disclosure title="Research interpretation" hint="Read the main observations from stored metrics.">
        <div>
          <p className="text-sm text-muted-foreground">
            Factual observations from stored metrics and context labels. Not a recommendation.
          </p>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {interpretation.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </Disclosure>

      {/* 5. Relative Value vs Contextual */}
      <Disclosure title="Valuation & comparisons" hint="Relative value, historical context and peer comparisons.">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Relative Value</h2>
          <p className="text-sm text-muted-foreground">{absoluteValuationBlurb()}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Relative Value Score</CardTitle>
            <CardDescription>
              Valuation factors only for this research profile. Separate from Research Score and
              from historical/peer labels below. This is the same stored result used by the market scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ScoreWithConfidence result={result} kind="valuation" />
            <MetricTable ids={profileIds.slice(0, isReit ? 3 : isBank ? 3 : 3)} metrics={metrics} />
          </CardContent>
        </Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <ValuationContextCard block={result.valuationContext.historical} />
          <ValuationContextCard block={result.valuationContext.peer} />
        </div>
      </Disclosure>

      <PersistedFairValue stored={fairValue} />

      {/* Profile metrics */}
      <Disclosure title={isReit ? "REIT metrics" : isBank ? "Bank metrics" : "Company metrics"} hint="Explore the profile-specific numbers.">
        <div>
          <p className="text-sm text-muted-foreground">
            Profile-relevant stored metrics. Missing values stay Unavailable.
          </p>
        </div>
        <MetricTable ids={profileIds} metrics={metrics} />
      </Disclosure>

      {result.concerns.length > 0 || instrument.pn17 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Flagged observations</h2>
            <p className="text-sm text-muted-foreground">
              Rule-based notices from stored data. They do not change Research Score unless scoring
              config enables a penalty (currently off).
            </p>
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {result.concerns.map((concern) => (
              <li key={concern.id}>
                <span className="font-medium">{concern.label}.</span> {plainConcern(concern.id, concern.message)}
                {concern.value !== null && Number.isFinite(concern.value)
                  ? ` Value: ${concern.value.toFixed(4)}.`
                  : ""}
                {concern.period ? ` Period: ${concern.period}.` : ""}
              </li>
            ))}
            {instrument.pn17 ? (
              <li className="text-destructive">
                PN17 listing status is stored on this name (status warning, not a score deduction).
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <Disclosure title="Financials" hint="Annual accounts and reported line items.">

        {annuals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Unavailable — no annual periods stored for this name.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                {annuals.map((row) => (
                  <TableHead key={row.id} className="text-right font-mono">
                    {row.periodEnd}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Fiscal period</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-fy`} className="text-right font-mono text-sm">
                    {row.fiscalPeriod ?? "Unavailable"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>Filing / report date</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-filing`} className="text-right font-mono text-sm">
                    {row.filingDate ?? "Unavailable"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>available_at</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-avail`} className="text-right font-mono text-sm">
                    {row.availableAt ?? "Unavailable"}
                  </TableCell>
                ))}
              </TableRow>
              {(
                [
                  ["Revenue", "revenue"],
                  ["PAT", "pat"],
                  ["EPS", "eps"],
                  ["Equity", "equity"],
                  ["Total debt", "totalDebt"],
                  ["Cash", "cash"],
                  ["OCF", "ocf"],
                  ["Capex", "capex"],
                  ["Dividend / share", "dividendPerShare"],
                  ["NAV / unit (reported)", "navPerShare"],
                  ["Total assets", "totalAssets"],
                  ["Gross profit", "grossProfit"],
                  ["EBIT / operating income", "ebit"],
                  ["Current assets", "currentAssets"],
                  ["Current liabilities", "currentLiabilities"],
                  ["Long-term debt", "longTermDebt"],
                ] as const
              ).map(([label, key]) => (
                <TableRow key={key}>
                  <TableCell>{label}</TableCell>
                  {annuals.map((row) => {
                    const items = parseLineItems(row.lineItemsJson);
                    const value = items?.[key] ?? null;
                    return (
                      <TableCell key={row.id} className="text-right tabular-nums">
                        {value === null || !Number.isFinite(value)
                          ? "Unavailable"
                          : key === "eps" || key === "dividendPerShare" || key === "navPerShare"
                            ? value.toFixed(3)
                            : formatMyr(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title="Price" hint="Trading range and moving averages.">

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stat</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>52-week high</TableCell>
              <TableCell className="text-right">{fmtRatio(metricById(metrics, "week52_high"))}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>52-week low</TableCell>
              <TableCell className="text-right">{fmtRatio(metricById(metrics, "week52_low"))}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Distance from 52-week high</TableCell>
              <TableCell className="text-right">
                {fmtRatio(metricById(metrics, "distance_from_52w_high"))}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>50-day average (stored bars)</TableCell>
              <TableCell className="text-right">
                {sma50 === null || !Number.isFinite(sma50) ? "Unavailable" : formatMyr(sma50)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>200-day average (stored bars)</TableCell>
              <TableCell className="text-right">
                {sma200 === null || !Number.isFinite(sma200) ? "Unavailable" : formatMyr(sma200)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Last volume</TableCell>
              <TableCell className="text-right">
                {lastVolume === null || !Number.isFinite(lastVolume)
                  ? "Unavailable"
                  : lastVolume.toLocaleString("en-MY")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Disclosure>


      <Disclosure title="Score history" hint="See how the stored research score has changed.">

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Unavailable — no persisted score runs yet.</p>
        ) : (
          <p className="text-sm">
            Research:{" "}
            {history
              .map((row) =>
                row.researchScore === null || !Number.isFinite(row.researchScore)
                  ? "Unavailable"
                  : row.researchScore.toFixed(0),
              )
              .reverse()
              .join(" → ")}
            <span className="mt-1 block text-muted-foreground">
              Latest stored run {formatDateSafe(history[0]?.asOf)}. Open score breakdown above for
              this run&apos;s evidence.
            </span>
          </p>
        )}
      </Disclosure>

      <Disclosure title="Export research" hint="Download or copy a report for further research."><ExportActions ticker={instrument.ticker} /></Disclosure>
    </main>
  );
}
