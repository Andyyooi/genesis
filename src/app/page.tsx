import Link from "next/link";
import { Disclosure } from "@/components/research/disclosure";
import { DashboardFilters } from "@/components/research/dashboard-filters";
import { StatusLabel } from "@/components/research/status-label";
import { TopPicks } from "@/components/research/top-picks";
import { cn } from "cn";
import { loadRecentAlerts } from "@/alerts/refresh";
import { loadScoringConfig } from "@/config/load-scoring";
import { loadLatestIngestReports } from "@/db/queries";
import { AlertsList } from "@/components/alerts/alerts-list";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PricesImportReport } from "@/ingest/types";
import { formatMyr } from "@/lib/format-myr";
import { dataConfidenceLabel, formatFreshnessBand, formatScore100 } from "@/lib/research-copy";
import { buildSnapshotDates } from "@/lib/snapshot-dates";
import {
  OPPORTUNITY_LISTS,
  parseDashboardFilters,
  parseDashboardSort,
  parseListId,
  rowMatchesFilters,
  rowMatchesList,
  sortOpportunityRows,
  type ListId,
} from "@/opportunities/lists";
import { scanWatchlist } from "@/opportunities/scan";

export const dynamic = "force-dynamic";

function fmtCoverage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${(value * 100).toFixed(0)}%`;
}

function listHref(
  id: ListId,
  extra?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (id !== "watchlist") params.set("list", id);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const listId = parseListId(typeof params.list === "string" ? params.list : undefined);
  const sortId = parseDashboardSort(typeof params.sort === "string" ? params.sort : undefined);
  const flagFilters = parseDashboardFilters({
    type: typeof params.type === "string" ? params.type : undefined,
    shariah: typeof params.shariah === "string" ? params.shariah : undefined,
    board: typeof params.board === "string" ? params.board : undefined,
    cap: typeof params.cap === "string" ? params.cap : undefined,
    confidence: typeof params.confidence === "string" ? params.confidence : undefined,
    freshness: typeof params.freshness === "string" ? params.freshness : undefined,
    profile: typeof params.profile === "string" ? params.profile : undefined,
    events: typeof params.events === "string" ? params.events : undefined,
  });
  const filterQuery = {
    type: flagFilters.instrumentType,
    shariah: flagFilters.shariah ? "yes" : undefined,
    board: flagFilters.board,
    cap: flagFilters.cap,
    confidence: flagFilters.confidence,
    freshness: flagFilters.freshness,
    profile: flagFilters.profile,
    events: flagFilters.events,
    sort: sortId !== "ticker" ? sortId : undefined,
  };

  let rows;
  let reports;
  let recentAlerts: ReturnType<typeof loadRecentAlerts> = [];
  try {
    loadScoringConfig();
    rows = scanWatchlist();
    reports = loadLatestIngestReports();
    recentAlerts = loadRecentAlerts(6);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist failed to load</h1>
        <p className="text-muted-foreground">
          Check <code className="font-mono text-sm">config/universe.yaml</code> and{" "}
          <code className="font-mono text-sm">config/scoring.yaml</code>.
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-sm">{message}</pre>
      </main>
    );
  }

  const activeList = OPPORTUNITY_LISTS.find((item) => item.id === listId) ?? OPPORTUNITY_LISTS[0]!;
  const listed = activeList.disabled ? [] : rows.filter((row) => rowMatchesList(row, listId));
  const filtered = listed.filter((row) => rowMatchesFilters(row, flagFilters));
  const visible = sortOpportunityRows(filtered, sortId);
  const counts = Object.fromEntries(
    OPPORTUNITY_LISTS.map((item) => [
      item.id,
      item.disabled ? 0 : rows.filter((row) => rowMatchesList(row, item.id)).length,
    ]),
  ) as Record<ListId, number>;

  const highConf = rows.filter((r) => r.confidence === "HIGH").length;
  const lowConf = rows.filter(
    (r) => r.confidence === "LOW" || r.confidence === "VERY_LOW" || r.needsVerification,
  ).length;
  const withEvents = rows.filter((r) => r.hasEvents).length;

  const sample = rows.find((row) => row.ticker === "MAYBANK") ?? rows[0];
  const lagDates = sample
    ? buildSnapshotDates({
        scoreAsOf: sample.result.asOf,
        lastTradeDate: sample.lastTradeDate,
        fundamentalsPeriod: sample.fundamentalsPeriod,
      })
    : null;

  const priceReport: PricesImportReport | null = reports.prices
    ? (JSON.parse(reports.prices.summaryJson) as PricesImportReport)
    : null;
  const yahooFails = priceReport?.failed ?? [];

  return (
    <main className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Bursa Malaysia · Research workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your research, at a glance.</h1>
        <p className="max-w-3xl text-muted-foreground">
          Follow your watchlist, compare the evidence, and open a company to explore.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <div className="summary-stat">
            <dt className="text-muted-foreground">On your watchlist</dt>
            <dd className="text-lg font-medium tabular-nums">{rows.length}</dd>
          </div>
          <div className="summary-stat positive">
            <dt className="text-muted-foreground">High confidence</dt>
            <dd className="text-lg font-medium tabular-nums">{highConf}</dd>
          </div>
          <div className="summary-stat caution">
            <dt className="text-muted-foreground">Needs a closer look</dt>
            <dd className="text-lg font-medium tabular-nums">{lowConf}</dd>
          </div>
          <div className="summary-stat info">
            <dt className="text-muted-foreground">With events</dt>
            <dd className="text-lg font-medium tabular-nums">{withEvents}</dd>
          </div>
        </dl>
      </header>

      {lagDates ? <DataLagBanner dates={lagDates} /> : null}
      <TopPicks />

      {yahooFails.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Yahoo missed {yahooFails.length} ticker{yahooFails.length === 1 ? "" : "s"}:{" "}
          {yahooFails.map((item) => item.ticker).join(", ")}. Details on the import report page — no
          prices were invented.
        </div>
      ) : null}

      <nav className="flex flex-col gap-2" aria-label="Research lists">
        <p className="text-sm font-medium">Research lists</p>
        <div className="flex flex-wrap gap-2">
          {OPPORTUNITY_LISTS.map((item) => {
            const selected = item.id === listId;
            return (
              <Link
                key={item.id}
                href={listHref(item.id, filterQuery)}
                className={cn(
                  buttonVariants({ variant: selected ? "default" : "outline", size: "sm" }),
                  item.disabled && !selected ? "opacity-60" : "",
                )}
              >
                {item.label}
                <span className="text-xs opacity-80">({counts[item.id]})</span>
              </Link>
            );
          })}
        </div>
        <details className="text-sm text-muted-foreground"><summary className="w-fit cursor-pointer text-primary">About this list</summary><p className="mt-2">{activeList.description}</p></details>
        {listId === "catalyst" ? (
          <p className="text-sm text-muted-foreground">
            Live announcements and news are not connected yet. This list uses previously saved
            announcements, not a live feed.
          </p>
        ) : null}
        {activeList.disabled ? (
          <p className="text-sm text-muted-foreground">{activeList.disabledReason}</p>
        ) : null}
      </nav>

      <DashboardFilters key={JSON.stringify(filterQuery)} listId={listId} values={filterQuery} />
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{activeList.label}</h2><p className="text-sm text-muted-foreground">{visible.length} of {listed.length} companies · select a company for details</p></div>

      <div className="overflow-x-auto rounded-lg border">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            {activeList.disabled
              ? activeList.disabledReason
              : listId === "catalyst"
                ? "No stored Positive catalyst, Negative, or Uncertain announcements."
                : listId === "improving"
                  ? "No name has two persisted score_runs with a higher latest Research Score."
                  : rows.length === 0
                    ? "The universe is empty. Add COMMON_STOCK or REIT rows to config/universe.yaml."
                    : listed.length > 0 && visible.length === 0
                      ? "No names match these filters. Clear confidence, freshness, profile, or stored-flag filters."
                      : "No names match this research list on the stored snapshots."}
          </p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Company</TableHead><TableHead className="text-right">Price (RM)</TableHead>
              <TableHead className="text-right">Research</TableHead><TableHead className="text-right">Valuation</TableHead>
              <TableHead>Data confidence</TableHead><TableHead>Accounts</TableHead><TableHead className="text-right">Coverage</TableHead>
            </TableRow></TableHeader>
            <TableBody>{visible.map((row) => <TableRow key={row.ticker} className="hover:bg-secondary/30">
              <TableCell className="min-w-56 whitespace-normal">
                <Link href={`/stock/${row.ticker}`} className="font-semibold text-primary underline-offset-4 hover:underline">{row.ticker}<span className="sr-only"> research</span></Link>
                {row.pn17 ? <Badge className="ml-2" variant="destructive">PN17</Badge> : null}
                <p className="mt-1 text-sm">{row.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.sector ?? "Sector unavailable"} · {row.researchProfile}</p>
                {!row.result.eligibility?.eligible ? <span className="mt-1 block text-xs text-amber-800">Excluded from recommendations</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.price === null || !Number.isFinite(row.price) ? "Unavailable" : formatMyr(row.price)}</TableCell>
              <TableCell className={cn("text-right text-base tabular-nums", row.needsVerification || row.confidence === "VERY_LOW" || row.confidence === "LOW" ? "text-muted-foreground" : "font-semibold text-primary")}>{formatScore100(row.researchScore)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatScore100(row.valuationScore)}</TableCell>
              <TableCell><StatusLabel level={row.confidence}>{dataConfidenceLabel(row.confidence)}</StatusLabel>{row.needsVerification ? <span className="mt-1 block text-xs text-amber-800">Needs verification</span> : null}</TableCell>
              <TableCell><StatusLabel level={row.freshness}>{formatFreshnessBand(row.freshness)}</StatusLabel></TableCell>
              <TableCell className="text-right tabular-nums">{row.coreCoverageLabel ?? fmtCoverage(row.coverage)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        )}
      </div>
      <Disclosure title="Recent alerts" hint={`${recentAlerts.length} recent updates · open to review`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Recent alerts</h2>
          <Link href="/alerts" className="text-sm underline underline-offset-4">
            All alerts
          </Link>
        </div>
        <AlertsList
          rows={recentAlerts}
          empty="No in-app alerts yet. Open All alerts to evaluate stored scores and announcements."
        />
      </Disclosure>

    </main>
  );
}
