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
import { RecentEventsSection } from "@/components/research/recent-events";
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
import { scoreTicker } from "@/scoring/run-ticker";

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
              <TableCell>{metric?.label ?? id}</TableCell>
              <TableCell className="text-right">{fmtRatio(metric)}</TableCell>
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
  const scored = scoreTicker(ticker, true);
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6">
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
          {instrument.pn17 ? <Badge variant="destructive">PN17</Badge> : null}
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
            <dt className="text-muted-foreground">Current price</dt>
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
          <p className="text-sm text-muted-foreground">
            REIT profile: distribution yield, book NAV, DPU growth, gearing and related REIT
            metrics. Industrial FCF and EV/EBITDA are not used.
          </p>
        ) : null}
        {isBank ? (
          <p className="text-sm text-muted-foreground">
            Bank profile: P/B, ROE, and bank health overlays where data exists. Industrial FCF and
            EV/EBITDA are not scoring factors.
          </p>
        ) : null}
      </header>

      {/* B. Research Score Card */}
      <ResearchScoreCard result={result} />

      {/* C. Score breakdown */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Score breakdown</h2>
          <p className="text-sm text-muted-foreground">
            Live weight is the share of this run after unavailable categories are dropped and
            remaining weights are renormalized. Unavailable factors are excluded — never treated as
            zero.
          </p>
        </div>
        <CategoryDisclosure categories={result.categories} />
      </section>

      {/* 3. Data Quality */}
      <DataQualitySection result={result} />

      {/* 4. Research interpretation */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Research interpretation</h2>
          <p className="text-sm text-muted-foreground">
            Factual observations from stored metrics and context labels. Not a recommendation.
          </p>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {interpretation.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </section>

      {/* 5. Absolute Valuation vs Contextual */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Absolute Valuation</h2>
          <p className="text-sm text-muted-foreground">{absoluteValuationBlurb()}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Absolute Valuation Score</CardTitle>
            <CardDescription>
              Valuation factors only for this research profile. Separate from Research Score and
              from historical/peer labels below.
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
      </section>

      {/* Profile metrics */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {isReit ? "REIT metrics" : isBank ? "Bank metrics" : "Company metrics"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Profile-relevant stored metrics. Missing values stay Unavailable.
          </p>
        </div>
        <MetricTable ids={profileIds} metrics={metrics} />
      </section>

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
                <span className="font-medium">{concern.label}.</span> {concern.message}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Financials</h2>
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
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Price</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stat</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Last close</TableCell>
              <TableCell className="text-right">{fmtRatio(lastClose)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Last trade date</TableCell>
              <TableCell className="text-right">{formatDateSafe(lastTrade?.period)}</TableCell>
            </TableRow>
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
      </section>

      <RecentEventsSection events={scored.events} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Score history</h2>
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
      </section>

      <ExportActions ticker={instrument.ticker} />
    </main>
  );
}
