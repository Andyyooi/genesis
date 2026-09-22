import Link from "next/link";
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
import { formatFreshnessBand, formatScore100 } from "@/lib/research-copy";
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
    <main className="mx-auto flex w-full max-w-[96rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Genesis Research</h1>
        <p className="max-w-3xl text-muted-foreground">
          Personal investment research for Bursa names. Scores show what the evidence supports —
          with coverage and confidence — not a ranked buy list.
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">Covered on watchlist</dt>
            <dd className="text-lg font-medium tabular-nums">{rows.length}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">High confidence</dt>
            <dd className="text-lg font-medium tabular-nums">{highConf}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">Low / needs verification</dt>
            <dd className="text-lg font-medium tabular-nums">{lowConf}</dd>
          </div>
          <div className="rounded-md border px-3 py-2">
            <dt className="text-muted-foreground">With stored events</dt>
            <dd className="text-lg font-medium tabular-nums">{withEvents}</dd>
          </div>
        </dl>
        <p className="text-sm">
          <Link href="/alerts" className="underline underline-offset-4">
            Alerts
          </Link>
          {" · "}
          <Link href="/market" className="underline underline-offset-4">
            Market scan
          </Link>
          {" · "}
          <Link href="/ingest" className="underline underline-offset-4">
            Import report
          </Link>
        </p>
      </header>

      {lagDates ? <DataLagBanner dates={lagDates} /> : null}

      <section className="flex flex-col gap-2">
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
      </section>

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
        <p className="text-sm text-muted-foreground">{activeList.description}</p>
        {activeList.disabled ? (
          <p className="text-sm text-muted-foreground">{activeList.disabledReason}</p>
        ) : null}
      </nav>

      <nav className="flex flex-col gap-3" aria-label="Filters and sort">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Sort by</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "Ticker", sort: "ticker" as const },
                { label: "Research Score", sort: "research" as const },
                { label: "Valuation Score", sort: "valuation" as const },
                { label: "Confidence", sort: "confidence" as const },
                { label: "Coverage", sort: "coverage" as const },
                { label: "Freshness", sort: "freshness" as const },
                { label: "Profile", sort: "profile" as const },
                { label: "Sector", sort: "sector" as const },
              ] as const
            ).map((item) => (
              <Link
                key={item.sort}
                href={listHref(listId, {
                  ...filterQuery,
                  sort: item.sort === "ticker" ? undefined : item.sort,
                })}
                className={cn(
                  buttonVariants({
                    variant: sortId === item.sort ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Evidence filters</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "Any confidence", confidence: undefined },
                { label: "HIGH", confidence: "HIGH" },
                { label: "MEDIUM", confidence: "MEDIUM" },
                { label: "LOW", confidence: "LOW" },
                { label: "VERY LOW", confidence: "VERY_LOW" },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, confidence: item.confidence })}
                className={cn(
                  buttonVariants({
                    variant:
                      (flagFilters.confidence ?? undefined) === item.confidence
                        ? "default"
                        : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
            {(
              [
                { label: "Any freshness", freshness: undefined },
                { label: "Fresh", freshness: "FRESH" },
                { label: "Aging", freshness: "AGING" },
                { label: "Stale", freshness: "STALE" },
                { label: "Very stale", freshness: "VERY_STALE" },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, freshness: item.freshness })}
                className={cn(
                  buttonVariants({
                    variant:
                      (flagFilters.freshness ?? undefined) === item.freshness
                        ? "default"
                        : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
            {(
              [
                { label: "Any profile", profile: undefined },
                { label: "GENERAL", profile: "GENERAL" },
                { label: "BANK", profile: "BANK" },
                { label: "REIT", profile: "REIT" },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, profile: item.profile })}
                className={cn(
                  buttonVariants({
                    variant:
                      (flagFilters.profile ?? undefined) === item.profile ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={listHref(listId, {
                ...filterQuery,
                events: flagFilters.events ? undefined : "yes",
              })}
              className={cn(
                buttonVariants({
                  variant: flagFilters.events ? "default" : "outline",
                  size: "sm",
                }),
              )}
            >
              Has events
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Stored flags (not scored)</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { label: "All types", type: undefined },
                { label: "Common stock", type: "COMMON_STOCK" as const },
                { label: "REIT", type: "REIT" as const },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, type: item.type })}
                className={cn(
                  buttonVariants({
                    variant:
                      (flagFilters.instrumentType ?? undefined) === item.type
                        ? "default"
                        : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={listHref(listId, {
                ...filterQuery,
                shariah: flagFilters.shariah ? undefined : "yes",
              })}
              className={cn(
                buttonVariants({
                  variant: flagFilters.shariah ? "default" : "outline",
                  size: "sm",
                }),
              )}
            >
              Shariah only
            </Link>
            {(
              [
                { label: "Any board", board: undefined },
                { label: "Main", board: "MAIN" },
                { label: "ACE", board: "ACE" },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, board: item.board })}
                className={cn(
                  buttonVariants({
                    variant: (flagFilters.board ?? undefined) === item.board ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
            {(
              [
                { label: "Any cap", cap: undefined },
                { label: "Large", cap: "large" as const },
                { label: "Mid", cap: "mid" as const },
                { label: "Small", cap: "small" as const },
              ] as const
            ).map((item) => (
              <Link
                key={item.label}
                href={listHref(listId, { ...filterQuery, cap: item.cap })}
                className={cn(
                  buttonVariants({
                    variant: (flagFilters.cap ?? undefined) === item.cap ? "default" : "outline",
                    size: "sm",
                  }),
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Showing {visible.length} of {listed.length} in this list
            {listed.length !== rows.length ? ` (${rows.length} on watchlist)` : ""}. Sort and filters
            are factual attributes — not a best-stock ranking.
          </p>
        </div>
      </nav>

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
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Research</TableHead>
                <TableHead className="text-right">Valuation</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Freshness</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead className="text-right">Quality</TableHead>
                <TableHead className="text-right">Growth</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.ticker} className="relative hover:bg-muted/40">
                  <TableCell className="font-mono font-medium">
                    <Link
                      href={`/stock/${row.ticker}`}
                      className="absolute inset-0"
                      aria-label={`Open ${row.ticker} research`}
                    />
                    <span className="relative z-10 underline underline-offset-4">{row.ticker}</span>
                    {row.instrumentType === "REIT" ? (
                      <Badge className="relative z-10 ml-1" variant="secondary">
                        REIT
                      </Badge>
                    ) : null}
                    <Badge className="relative z-10 ml-1" variant="outline">
                      {row.researchProfile}
                    </Badge>
                    {row.pn17 ? (
                      <Badge className="relative z-10 ml-1" variant="destructive">
                        PN17
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="max-w-36 truncate text-muted-foreground">
                    {row.sector ?? "Unavailable"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.price === null || !Number.isFinite(row.price)
                      ? "Unavailable"
                      : formatMyr(row.price)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.needsVerification ||
                        row.confidence === "VERY_LOW" ||
                        row.confidence === "LOW"
                        ? "text-muted-foreground"
                        : "font-medium",
                    )}
                  >
                    {formatScore100(row.researchScore)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.needsVerification ||
                        row.confidence === "VERY_LOW" ||
                        row.confidence === "LOW"
                        ? "text-muted-foreground"
                        : undefined,
                    )}
                  >
                    {formatScore100(row.valuationScore)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.confidence === "VERY_LOW"
                          ? "destructive"
                          : row.confidence === "HIGH"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {row.confidence ?? "Unavailable"}
                    </Badge>
                    {row.needsVerification ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Needs verification
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatFreshnessBand(row.freshness)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.coreCoverageLabel ?? fmtCoverage(row.coverage)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.qualityScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.growthScore)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.hasEvents ? row.eventCount : "—"}
                  </TableCell>
                  <TableCell className="max-w-48 text-sm text-muted-foreground">
                    {row.catalystLabel ? <span className="block">{row.catalystLabel}</span> : null}
                    {row.mainConcern ? <span className="block">Concern: {row.mainConcern}</span> : null}
                    {!row.catalystLabel && !row.mainConcern ? "—" : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </main>
  );
}
