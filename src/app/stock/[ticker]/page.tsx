import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryDisclosure } from "@/components/research/category-disclosure";
import { ExportActions } from "@/components/research/export-actions";
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
import { DataConfidenceCard, ScoreWithConfidence } from "@/components/research/data-confidence";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { ValuationContextCard } from "@/components/research/valuation-context";
import { loadScoreHistory } from "@/db/queries";
import type { LineItems } from "@/ingest/types";
import { formatMetricValue } from "@/lib/format-metric";
import { formatMyr } from "@/lib/format-myr";
import {
  formatScore100,
  scoreNarrative,
  strongestPositives,
} from "@/lib/research-copy";
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
  if (!metric) return "Data unavailable";
  return formatMetricValue(metric);
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
  const positives = strongestPositives(result);
  const annuals = periods.filter((p) => p.statementType === "annual").slice(0, 6);
  const closes = bars.map((b) => b.close).filter((n): n is number => n !== null);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const lastVolume = bars[0]?.volume ?? null;
  const isReit = scored.instrumentType === "REIT";
  const isBank = result.researchProfile === "BANK" || result.profile === "bank";
  const valuationIds = isReit
    ? ["dividend_yield", "book_nav_premium", "price_to_book", "nav_per_share"]
    : isBank
      ? ["price_to_book", "dividend_yield", "price_to_earnings"]
      : ["price_to_earnings", "dividend_yield", "price_to_book"];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="text-foreground underline underline-offset-4">
          Dashboard
        </Link>
        <span> · research page · not a buy or sell</span>
      </p>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{instrument.name}</h1>
          <Badge variant={isReit ? "secondary" : "outline"}>
            {isReit ? "REIT" : "Common stock"}
          </Badge>
          <Badge variant="outline">Profile {result.researchProfile}</Badge>
          {instrument.pn17 ? <Badge variant="destructive">PN17 — higher risk</Badge> : null}
          {instrument.shariahCompliant === true ? (
            <Badge variant="secondary">Shariah (stored flag)</Badge>
          ) : instrument.shariahCompliant === false ? (
            <Badge variant="outline">Not Shariah (stored flag)</Badge>
          ) : null}
          {instrument.listingBoard ? (
            <Badge variant="outline">{instrument.listingBoard}</Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          Ticker {instrument.ticker}
          {instrument.bursaCode ? ` · Bursa ${instrument.bursaCode}` : ""}
          {instrument.sector ? ` · ${instrument.sector}` : " · Sector: Data unavailable"}
        </p>
        <p className="text-lg">
          Current price: {fmtRatio(lastClose)}
          <span className="ml-2 text-sm text-muted-foreground">
            last trade {lastTrade?.period ?? "Data unavailable"}
          </span>
        </p>
        <DataLagBanner dates={snapshotDates} />
        {isReit ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            Scored with the <span className="font-medium">REIT factor profile</span> (distribution
            yield, book NAV premium, DPU CAGR, gearing). Industrial FCF, net debt/EBITDA, EV/EBITDA,
            and ordinary-company P/E are not used.
          </p>
        ) : null}
        {isBank ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            Scored with the <span className="font-medium">bank overlay</span> (P/B and ROE). Industrial
            FCF and EV/EBITDA are not scoring factors. Health is omitted when those industrial
            measures are the only configured health inputs.
          </p>
        ) : null}
          <p className="text-sm text-muted-foreground">
            Expected core factors {result.dataCoverage.expected} · available {result.dataCoverage.available} ·
            unavailable {result.dataCoverage.unavailable}
            {result.dataConfidence.needsVerification ? " · needs verification" : ""}.
          </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Research Score</CardTitle>
            <CardDescription>
              Mix of live categories. News and technical are not in this run; remaining weights are
              renormalized. Not a verdict on cheap vs good.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreWithConfidence result={result} kind="research" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Valuation Score</CardTitle>
            <CardDescription>
              Valuation factors only — answers “does the price look demanding?” It is not a second
              copy of the Research Score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScoreWithConfidence result={result} kind="valuation" />
          </CardContent>
        </Card>
        <DataConfidenceCard result={result} />
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <ValuationContextCard block={result.valuationContext.historical} />
        <ValuationContextCard block={result.valuationContext.peer} />
      </section>
      <p className="text-sm text-muted-foreground">{scoreNarrative(result)}</p>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold">Score breakdown</h2>
          <p className="text-sm text-muted-foreground">
            Summary first. Open a category, then a factor, for inputs, formula, and period.
            Unavailable factors are listed and omitted from the average — never scored as zero.
          </p>
        </div>
        <CategoryDisclosure categories={result.categories} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Why it is interesting</h2>
        {positives.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No factor scored 60 or above in this run. That is not a sell signal — coverage may be
            thin.
          </p>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {positives.map((factor) => (
              <li key={factor.id}>
                <span className="font-medium">{factor.label}</span> scored{" "}
                {formatScore100(factor.score)}
                {factor.period ? ` (${factor.period})` : ""}. {factor.formula}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Potential Concerns</h2>
        <p className="text-sm text-muted-foreground">
          These factors triggered a warning. This is not a “value trap” stamp and does not change
          the Research Score.
        </p>
        {result.concerns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No concern rules fired for this snapshot.</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {result.concerns.map((concern) => (
              <li key={concern.id}>
                <span className="font-medium">{concern.label}.</span> {concern.message}
                {concern.value !== null ? ` Value: ${concern.value.toFixed(4)}.` : ""}
                {concern.period ? ` Period: ${concern.period}.` : ""}
              </li>
            ))}
          </ul>
        )}
        {instrument.pn17 ? (
          <p className="text-sm text-destructive">
            PN17 is a listing-status warning (higher risk), not a hidden score deduction.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Valuation</h2>
        <p className="text-sm text-muted-foreground">
          Absolute snapshot used in the Valuation Score (last close vs latest annual). Historical and
          peer labels above are separate — they do not change this score.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="hidden sm:table-cell">Period</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {valuationIds.map((id) => {
              const metric = metricById(metrics, id);
              return (
                <TableRow key={id}>
                  <TableCell>{metric?.label ?? id}</TableCell>
                  <TableCell className="text-right">{fmtRatio(metric)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {metric?.period ?? "Data unavailable"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {isReit ? (
          <p className="text-sm text-muted-foreground">
            Ordinary-company P/E is shown only as a raw metric if the snapshot has EPS. It is not in
            the REIT scoring profile.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Financials</h2>
        {annuals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No annual periods stored. Import a fundamentals CSV. Missing cells stay Data unavailable.
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
                    {row.fiscalPeriod ?? "Data unavailable"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>Filing / report date</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-filing`} className="text-right font-mono text-sm">
                    {row.filingDate ?? "UNKNOWN"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>available_at</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-avail`} className="text-right font-mono text-sm">
                    {row.availableAt ?? "UNKNOWN"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>available_at source</TableCell>
                {annuals.map((row) => (
                  <TableCell key={`${row.id}-asrc`} className="text-right text-sm text-muted-foreground">
                    {row.availableAtSource ?? "—"}
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
                        {value === null
                          ? "Data unavailable"
                          : key === "eps" || key === "dividendPerShare" || key === "navPerShare"
                            ? value.toFixed(3)
                            : formatMyr(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Net margin / ROE (latest scored period)</TableCell>
                {annuals.map((row) => (
                  <TableCell key={row.id} className="text-right text-muted-foreground">
                    {row.periodEnd === metricById(metrics, "net_margin")?.period
                      ? `${fmtRatio(metricById(metrics, "net_margin"))} / ${fmtRatio(metricById(metrics, "roe"))}`
                      : "Data unavailable"}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell>ROIC</TableCell>
                {annuals.map((row) => (
                  <TableCell key={row.id} className="text-right">
                    Data unavailable
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Price</h2>
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
              <TableCell className="text-right">{lastTrade?.period ?? "Data unavailable"}</TableCell>
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
              <TableCell className="text-right">{sma50 === null ? "Data unavailable" : formatMyr(sma50)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>200-day average (stored bars)</TableCell>
              <TableCell className="text-right">{sma200 === null ? "Data unavailable" : formatMyr(sma200)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Last volume</TableCell>
              <TableCell className="text-right">
                {lastVolume === null ? "Data unavailable" : lastVolume.toLocaleString("en-MY")}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Price chart</TableCell>
              <TableCell className="text-right">Data unavailable (charts later)</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">News & announcements</h2>
        <p className="text-sm text-muted-foreground">
          Stored CSV rows only. Classification is keyword rules (or a label you typed). Headlines
          are not facts and this is not a buy list. Open the original URL.
        </p>
        {scored.events.length === 0 ? (
          <p className="text-sm">Data unavailable — import data/raw/announcements-sample.csv.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Headline</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead className="hidden md:table-cell">Relevance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scored.events.map((event, index) => (
                <TableRow key={`${event.occurredAt}-${index}`}>
                  <TableCell className="whitespace-nowrap">{event.occurredAt}</TableCell>
                  <TableCell>{event.source}</TableCell>
                  <TableCell>
                    {event.sourceUrl ? (
                      <a
                        href={event.sourceUrl}
                        className="underline underline-offset-4"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {event.headline}
                      </a>
                    ) : (
                      event.headline
                    )}
                  </TableCell>
                  <TableCell>{event.classification}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {event.relevanceNote ?? "Data unavailable"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Score history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Data unavailable — no persisted score runs yet.</p>
        ) : (
          <p className="text-sm">
            Research:{" "}
            {history
              .map((row) => (row.researchScore === null ? "—" : row.researchScore.toFixed(0)))
              .reverse()
              .join(" → ")}
            <span className="block text-muted-foreground">
              Latest run {history[0]?.asOf}. Charting why a score moved is later; open a category
              above for this run’s evidence.
            </span>
          </p>
        )}
      </section>
    </main>
  );
}
