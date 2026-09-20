import Link from "next/link";
import { loadScoringConfig } from "@/config/load-scoring";
import { loadLatestIngestReports, loadWatchlist } from "@/db/queries";
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
import type { PricesImportReport } from "@/ingest/types";
import { formatMyr } from "@/lib/format-myr";

export const dynamic = "force-dynamic";

export default function HomePage() {
  let rows;
  let reports;
  try {
    loadScoringConfig();
    rows = loadWatchlist();
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

  const reitCount = rows.filter((row) => row.instrumentType === "REIT").length;
  const pn17Count = rows.filter((row) => row.pn17).length;
  const priceReport: PricesImportReport | null = reports.prices
    ? (JSON.parse(reports.prices.summaryJson) as PricesImportReport)
    : null;
  const yahooFails = priceReport?.failed ?? [];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Phase 2 · local only · English · MYR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Bursa watchlist</h1>
        <p className="max-w-2xl text-muted-foreground">
          Snapshots only — no scores. Import CSV fundamentals and Yahoo daily prices, then
          open a ticker to inspect periods and the price series. Missing values stay{" "}
          <span className="text-foreground">Data unavailable</span>.
        </p>
        <p className="text-sm">
          <Link href="/ingest" className="underline underline-offset-4">
            Import report
          </Link>
          <span className="text-muted-foreground">
            {" "}
            · npm run ingest (CSV + Yahoo)
          </span>
        </p>
      </header>

      {yahooFails.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Yahoo missed {yahooFails.length} ticker{yahooFails.length === 1 ? "" : "s"}:{" "}
          {yahooFails.map((item) => item.ticker).join(", ")}. Details on the import report
          page — no prices were invented.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Names in SQLite</CardTitle>
            <CardDescription>andy-watchlist</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">REITs</CardTitle>
            <CardDescription>Separate factor profile later</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{reitCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PN17 flagged</CardTitle>
            <CardDescription>Status warning, not a score</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{pn17Count}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tickers</CardTitle>
          <CardDescription>
            Last trade date is from stored Yahoo bars. Open inspect to see every imported
            period — wrong CSV rows are listed on the import report, not hidden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The universe is empty. Add COMMON_STOCK or REIT rows to{" "}
              <code className="font-mono">config/universe.yaml</code> and refresh.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead className="hidden sm:table-cell">Bursa</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Last price</TableHead>
                  <TableHead className="hidden md:table-cell">Last trade</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Bars</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Periods</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-medium">
                      <Link href={`/inspect/${row.ticker}`} className="underline underline-offset-4">
                        {row.ticker}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden font-mono text-muted-foreground sm:table-cell">
                      {row.bursaCode ?? "—"}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      <Badge variant={row.instrumentType === "REIT" ? "secondary" : "outline"}>
                        {row.instrumentType === "REIT" ? "REIT" : "Common stock"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.pn17 ? (
                        <Badge variant="destructive">PN17 — higher risk</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Listed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatMyr(row.lastClose)}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {row.lastTradeDate ?? "Data unavailable"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {row.barCount}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {row.periodCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
