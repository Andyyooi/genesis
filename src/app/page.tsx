import Link from "next/link";
import { cn } from "cn";
import { loadScoringConfig } from "@/config/load-scoring";
import { loadLatestIngestReports } from "@/db/queries";
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
  parseListId,
  rowMatchesList,
  type ListId,
} from "@/opportunities/lists";
import { scanWatchlist } from "@/opportunities/scan";

export const dynamic = "force-dynamic";

function fmtCoverage(value: number | null): string {
  if (value === null) return "Data unavailable";
  return `${(value * 100).toFixed(0)}%`;
}

function listHref(id: ListId): string {
  return id === "watchlist" ? "/" : `/?list=${id}`;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const listId = parseListId(typeof params.list === "string" ? params.list : undefined);

  let rows;
  let reports;
  try {
    loadScoringConfig();
    rows = scanWatchlist();
    reports = loadLatestIngestReports();
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
  const visible = activeList.disabled ? [] : rows.filter((row) => rowMatchesList(row, listId));
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
        <p className="text-sm text-muted-foreground">Phase 8 · local only · English · MYR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Research dashboard</h1>
        <p className="max-w-3xl text-muted-foreground">
          Watchlist is the current universe. Named lists are research filters, not buy orders. REIT
          rows use the REIT scoring profile. Click a name to open its research page.
        </p>
        <p className="text-sm">
          <Link href="/ingest" className="underline underline-offset-4">
            Import report
          </Link>
        </p>
      </header>

      {lagDates ? <DataLagBanner dates={lagDates} /> : null}

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
                href={item.disabled ? `/?list=${item.id}` : listHref(item.id)}
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
