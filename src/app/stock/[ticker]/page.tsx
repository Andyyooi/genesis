import { Disclosure } from "@/components/research/disclosure";
import { DividendHistory } from "@/components/research/dividend-history";
import { FinancialTerm } from "@/components/research/financial-term";
import { plainConcern } from "@/lib/financial-terms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryDisclosure } from "@/components/research/category-disclosure";
import { StatusLabel } from "@/components/research/status-label";
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
import { formatMyr, formatSharePrice } from "@/lib/format-myr";
import { movingAverage } from "@/lib/price-history";
import { formatScore100 } from "@/lib/research-copy";
import {
  absoluteValuationBlurb,
  researchInterpretationBullets,
} from "@/lib/research-presentation";
import { buildSnapshotDates, latestAnnualPeriod } from "@/lib/snapshot-dates";
import type { MetricValue } from "@/metrics/types";
import { PersistedFairValue } from "@/components/research/persisted-fair-value";
import { loadPersistedFairValueForPage } from "@/fair-value/load-persisted-page";
import { FairRangeLine } from "@/components/research/fair-range-line";
import { fairRangeHeadline } from "@/lib/fair-range";
import { BUY_SCORE_BACKTEST_NOTE, buyScoreValue, buyScoreVerdict } from "@/lib/buy-score";
import { publishedBuyScore } from "@/scoring/published-research-scores";
import { scoreTicker } from "@/scoring/run-ticker";
import { PriceChart } from "@/components/research/price-chart";
import { loadSavedPrices } from "@/db/price-history";
import { StockNewsSection } from "@/components/news-headlines";
import { GoodCompanyPriceDownCard, LatestResultsLine } from "@/components/research/price-drop-flag";
import { goodCompanyPriceDown, latestResultsComparison } from "@/lib/price-drop-flag";

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

function fmtRatio(metric: MetricValue | undefined): string {
  if (!metric) return "Unavailable";
  if (metric.available && ["week52_high", "week52_low"].includes(metric.id)) return formatSharePrice(metric.value);
  return formatMetricValue(metric);
}

const annualFields = [
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
] as const;

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
  const prices = loadSavedPrices(instrument.ticker, -1);
  const latestPrice = prices.at(-1);
  const close = latestPrice ? latestPrice.close : lastClose?.available ? lastClose.value : null;
  const priceDate = latestPrice?.date ?? lastTrade?.period;
  const snapshotDates = buildSnapshotDates({
    scoreAsOf: result.asOf,
    lastTradeDate: priceDate ?? null,
    fundamentalsPeriod: latestAnnualPeriod(periods),
  });
  const annuals = periods.filter((p) => p.statementType === "annual").slice(0, 6);
  const annualRows = annuals.map((row) => {
    const items = parseLineItems(row.lineItemsJson);
    return {
      ...row,
      fields: [
        ["Fiscal period", row.fiscalPeriod ?? "Unavailable"],
        ["Filing / report date", row.filingDate ?? "Unavailable"],
        ["Available from", row.availableAt ?? "Unavailable"],
        ...annualFields.map(([label, key]) => {
          const value = items?.[key] ?? null;
          return [label, value === null || !Number.isFinite(value) ? "Unavailable"
            : key === "eps" || key === "dividendPerShare" || key === "navPerShare" ? value.toFixed(3)
              : formatMyr(value)];
        }),
      ],
    };
  });
  const sma50 = movingAverage(prices, 50).at(-1)?.close;
  const sma200 = movingAverage(prices, 200).at(-1)?.close;
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
  const fairRange = fairRangeHeadline(fairValue, close);
  const priceDownFlag = goodCompanyPriceDown({ result, bars, periods, pn17: instrument.pn17, includeSales: !isBank });
  const latestResults = priceDownFlag ? null : latestResultsComparison(periods, { includeSales: !isBank });
  const buy = publishedBuyScore({ researchScore: result.researchScore, eligible: result.eligibility?.eligible === true, needsVerification: result.dataConfidence.needsVerification });
  const verdict = buyScoreVerdict(buy);
  const size = metricById(metrics, "market_cap");
  const dividendYield = metricById(metrics, "dividend_yield");
  const riskFlag = instrument.pn17 ? "Financial distress (PN17)"
    : instrument.warningFlag ? "Listing warning"
      : result.dataConfidence.needsVerification ? "Check the evidence"
        : result.concerns.length > 0 ? `${result.concerns.length} flagged ${result.concerns.length === 1 ? "check" : "checks"}`
          : "No stored flags";

  return (
    <main className="stock-research mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="text-foreground underline underline-offset-4">
          Dashboard
        </Link>
      </p>

      {/* A. Header */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{instrument.name}</h1>
          <Badge variant={isReit ? "secondary" : "outline"}>{instrumentLabel}</Badge>
          <Badge variant="outline">{result.researchProfile}</Badge>
          {priceDownFlag ? (
            <Badge variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300">
              Strong company, price down
            </Badge>
          ) : null}
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
      </header>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Stock at a glance">
        <section className="market-card min-w-0 p-4" aria-label="Price and Buy score">
          <div className="mb-2 grid grid-cols-2 gap-3">
            <div>
              <h2 className="text-xs font-medium text-muted-foreground">Last close</h2>
              <p className="text-xl font-semibold tabular-nums">{formatSharePrice(close)}</p>
              <p className="text-xs text-muted-foreground">{formatDateSafe(priceDate)}</p>
            </div>
            <div>
              <h2 className="text-xs font-medium text-muted-foreground">Buy score</h2>
              <p className="text-xl font-semibold tabular-nums">{formatScore100(buyScoreValue(buy))}</p>
            </div>
          </div>
          <StatusLabel level={verdict.tone}>{verdict.label}</StatusLabel>
          <p className="mt-1.5 text-xs text-muted-foreground">{verdict.why}</p>
          <details className="mt-1.5 text-xs text-muted-foreground">
            <summary className="cursor-pointer">How good is a high Buy score?</summary>
            <p className="mt-1">The Buy score ranks this stock&apos;s research score ({formatScore100(result.researchScore)}) against every other stock, then holds it below 70 if a safety check fails. {BUY_SCORE_BACKTEST_NOTE}</p>
          </details>
        </section>
        <section className="market-card min-w-0 p-4">
          <h2 className="font-semibold">Fair price range</h2>
          <p className="mb-2 text-xs text-muted-foreground">Entry price guide, not part of the Buy score.</p>
          <FairRangeLine range={fairRange} compact />
        </section>
        <section className="market-card min-w-0 p-4 md:col-span-2 lg:col-span-1">
          <h2 className="mb-2 font-semibold">Key numbers</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <div><dt className="text-xs text-muted-foreground">Research score</dt><dd className="font-medium">{formatScore100(result.researchScore)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Valuation score</dt><dd className="font-medium">{formatScore100(result.valuationScore)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{isReit ? "Distribution yield" : "Dividend yield"}</dt><dd className="font-medium">{dividendYield?.available ? fmtRatio(dividendYield) : "Unavailable"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Company size</dt><dd className="font-medium">{size?.available && size.value !== null && Number.isFinite(size.value) ? `RM ${size.value.toLocaleString("en-MY", { notation: "compact", maximumFractionDigits: 1 })}` : "Unavailable"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Risk flags</dt><dd><StatusLabel level={instrument.pn17 ? "PN17" : riskFlag !== "No stored flags" ? "LOW" : "UNKNOWN"}>{riskFlag}</StatusLabel></dd></div>
          </dl>
        </section>
      </div>

      <PriceChart ticker={instrument.ticker} points={prices} />

      <div className="stock-details-grid grid items-start gap-3 md:grid-cols-2">
      <Disclosure title="Saved data & latest results" hint={`Research run: ${formatDateSafe(result.asOf)}`}>
        <LatestResultsLine results={latestResults} />
        {priceDownFlag ? <GoodCompanyPriceDownCard flag={priceDownFlag} /> : null}
        <DataLagBanner dates={snapshotDates} />
        {isReit ? (
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer text-primary">About property-fund (REIT) research</summary><p className="mt-2">Property funds are compared using cash payments to investors, net property assets, growth in payments and borrowing. Ordinary-company cash-flow and operating-earnings comparisons are not used.
          </p></details>
        ) : null}
        {isBank ? (
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer text-primary">About bank research</summary><p className="mt-2">Banks are compared using price versus net assets (P/B), profit on shareholders’ money (ROE), and bank health checks where data exists. Ordinary-company cash-flow and operating-earnings comparisons are not used.
          </p></details>
        ) : null}
      </Disclosure>

      {/* C. Score breakdown */}
      <Disclosure title="Score breakdown" hint="See the financial and price checks (factors) behind this score.">
        <ResearchScoreCard result={result} />
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

      <Disclosure title="Fair value" hint="See the price estimates and the checks behind them.">
        <FairRangeLine range={fairRange} />
        <PersistedFairValue stored={fairValue} />
      </Disclosure>

      {/* Profile metrics */}
      <Disclosure title={isReit ? "REIT metrics" : isBank ? "Bank metrics" : "Company metrics"} hint="Explore the profile-specific numbers.">
        <div>
          <p className="text-sm text-muted-foreground">
            Profile-relevant stored metrics. Missing values stay Unavailable.
          </p>
        </div>
        <MetricTable ids={profileIds} metrics={metrics} />
      </Disclosure>

      {result.concerns.length > 0 || instrument.pn17 || instrument.warningFlag ? (
        <Disclosure title="Flagged observations" hint="See which saved checks raised a concern.">
          <div>
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
            {instrument.warningFlag && !instrument.pn17 ? <li>A listing warning is stored for this company.</li> : null}
          </ul>
        </Disclosure>
      ) : null}

      <Disclosure title="Dividend history" hint="Five years of reported cash payments.">
        <DividendHistory key={instrument.ticker} ticker={instrument.ticker} />
      </Disclosure>

      <Disclosure title="Company news" hint="Read recent headlines about this company.">
        <StockNewsSection ticker={instrument.ticker} />
      </Disclosure>

      <Disclosure title="Financials" hint="Annual accounts and reported line items.">

        {annuals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Unavailable — no annual periods stored for this name.
          </p>
        ) : (<>
          <div className="grid gap-2 lg:hidden">
            {annualRows.map((row) => (
              <Disclosure key={row.id} title={row.periodEnd}>
                <dl className="space-y-2 text-sm">
                  {row.fields.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-2 gap-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            ))}
          </div>
          <div className="hidden lg:block">
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
              {annualRows[0].fields.map(([label], index) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  {annualRows.map((row) => (
                    <TableCell key={row.id} className="text-right tabular-nums">{row.fields[index][1]}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </>)}
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
                {formatSharePrice(sma50)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>200-day average (stored bars)</TableCell>
              <TableCell className="text-right">
                {formatSharePrice(sma200)}
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
      </div>
    </main>
  );
}
