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
import { formatScore100 } from "@/lib/research-copy";
import { buildSnapshotDates } from "@/lib/snapshot-dates";
import {
  OPPORTUNITY_LISTS,
  parseDashboardFilters,
  parseListId,
  rowMatchesFilters,
  rowMatchesList,
  type ListId,
} from "@/opportunities/lists";
import { scanWatchlist } from "@/opportunities/scan";

export const dynamic = "force-dynamic";

function fmtCoverage(value: number | null): string {
  if (value === null) return "Data unavailable";
  return `${(value * 100).toFixed(0)}%`;
}

function listHref(id: ListId, extra?: Record<string, string | undefined>): string {
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
  const flagFilters = parseDashboardFilters({
    type: typeof params.type === "string" ? params.type : undefined,
    shariah: typeof params.shariah === "string" ? params.shariah : undefined,
    board: typeof params.board === "string" ? params.board : undefined,
    cap: typeof params.cap === "string" ? params.cap : undefined,
  });
  const filterQuery = {
    type: flagFilters.instrumentType,
    shariah: flagFilters.shariah ? "yes" : undefined,
    board: flagFilters.board,
    cap: flagFilters.cap,
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
  const visible = listed.filter((row) => rowMatchesFilters(row, flagFilters));
  const counts = Object.fromEntries(
    OPPORTUNITY_LISTS.map((item) => [
      item.id,
      item.disabled ? 0 : rows.filter((row) => rowMatchesList(row, item.id)).length,
    ]),
  ) as Record<ListId, number>;

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
        <p className="text-sm text-muted-foreground">Phase 10 · local only · English · MYR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Research dashboard</h1>
        <p className="max-w-3xl text-muted-foreground">
          Watchlist is Andy’s YAML names, not the full Bursa tape. Named lists are research filters,
          not buy orders. Open Market scan for the last universe-wide run. REITs use the REIT
          profile; banks use a P/B+ROE overlay. Shariah and cap-size are stored flags, not scored
          factors.
        </p>
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
                href={item.disabled ? listHref(item.id, filterQuery) : listHref(item.id, filterQuery)}
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

      <nav className="flex flex-col gap-2" aria-label="Stored flags">
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
                  variant: (flagFilters.instrumentType ?? undefined) === item.type ? "default" : "outline",
                  size: "sm",
                }),
              )}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href={listHref(listId, { ...filterQuery, shariah: flagFilters.shariah ? undefined : "yes" })}
            className={cn(buttonVariants({ variant: flagFilters.shariah ? "default" : "outline", size: "sm" }))}
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
          Cap uses last close × shares when shares exist (large ≥ RM10bn, mid ≥ RM2bn). Missing
          market cap is excluded from a cap filter — not filled in. ACE is empty on this watchlist.
        </p>
      </nav>

      <div className="overflow-x-auto rounded-lg border">
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            {activeList.disabled
              ? activeList.disabledReason
              : listId === "catalyst"
                ? "No stored Positive catalyst, Negative, or Uncertain announcements. Import a CSV — nothing is invented."
              : listId === "improving"
                ? "No name has two persisted score_runs with a higher latest Research Score. Repeating the same filings does not count as improvement."
                : rows.length === 0
                  ? "The universe is empty. Add COMMON_STOCK or REIT rows to config/universe.yaml."
                  : listed.length > 0 && visible.length === 0
                    ? "No names match these stored-flag filters. Clear Shariah, board, or cap — missing market cap is not invented."
                  : "No names match this research list on the stored snapshots."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Last trade</TableHead>
                <TableHead>Fundamentals period</TableHead>
                <TableHead className="text-right">Research</TableHead>
                <TableHead className="text-right">Valuation</TableHead>
                <TableHead className="text-right">Quality</TableHead>
                <TableHead className="text-right">Growth</TableHead>
                <TableHead className="text-right">Health</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead>Catalyst / concern</TableHead>
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
                    {row.result.profile === "bank" ? (
                      <Badge className="relative z-10 ml-1" variant="outline">
                        Bank
                      </Badge>
                    ) : null}
                    {row.shariahCompliant === true ? (
                      <Badge className="relative z-10 ml-1" variant="secondary">
                        Shariah
                      </Badge>
                    ) : null}
                    {row.pn17 ? (
                      <Badge className="relative z-10 ml-1" variant="destructive">
                        PN17
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMyr(row.price)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.lastTradeDate ?? "Data unavailable"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.fundamentalsPeriod ?? "Data unavailable"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.researchScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.valuationScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.qualityScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.growthScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore100(row.healthScore)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCoverage(row.coverage)}</TableCell>
                  <TableCell className="max-w-56 text-sm text-muted-foreground">
                    {row.catalystLabel ? <span className="block">Catalyst: {row.catalystLabel}</span> : null}
                    {row.mainConcern ? <span className="block">Concern: {row.mainConcern}</span> : null}
                    {!row.catalystLabel && !row.mainConcern ? "Data unavailable" : null}
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
