import Link from "next/link";
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
import { loadLatestIngestReports } from "@/db/queries";
import type { FundamentalsImportReport, PricesImportReport } from "@/ingest/types";

export const dynamic = "force-dynamic";

export default function IngestReportPage() {
  const reports = loadLatestIngestReports();
  const fundamentals = reports.fundamentals
    ? (JSON.parse(reports.fundamentals.summaryJson) as FundamentalsImportReport)
    : null;
  const prices = reports.prices
    ? (JSON.parse(reports.prices.summaryJson) as PricesImportReport)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Watchlist
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Import report</h1>
        <p className="max-w-2xl text-muted-foreground">
          Rejected CSV rows and Yahoo misses stay here so they can be fixed. Nothing is
          silently filled in. Re-run ingest after editing the CSV or universe mapping.
        </p>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono">npm run ingest:fundamentals -- data/raw/fundamentals-sample.csv</code>
          <br />
          <code className="font-mono">npm run ingest:prices</code>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Fundamentals CSV</CardTitle>
          <CardDescription>
            {fundamentals
              ? `${fundamentals.file} · ${fundamentals.upserted} stored · ${fundamentals.rejected.length} rejected · ${fundamentals.finishedAt}`
              : "No CSV import has been run yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!fundamentals || fundamentals.rejected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {fundamentals
                ? "No rejected rows in the last import."
                : "Template: data/raw/fundamentals-template.csv"}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CSV row</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Why it was rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fundamentals.rejected.map((row) => (
                  <TableRow key={`${row.rowNumber}-${row.reason}`}>
                    <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
                    <TableCell className="font-mono">{row.ticker ?? "—"}</TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Yahoo daily prices</CardTitle>
          <CardDescription>
            {prices
              ? `${prices.succeeded.length} tickers stored · ${prices.failed.length} missed · ${prices.barsUpserted} bars upserted · ${prices.finishedAt}`
              : "No Yahoo import has been run yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!prices ? (
            <p className="text-sm text-muted-foreground">Run npm run ingest:prices.</p>
          ) : prices.failed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Yahoo returned bars for every universe ticker in the last run.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Yahoo symbol</TableHead>
                  <TableHead>Failure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.failed.map((row) => (
                  <TableRow key={row.ticker}>
                    <TableCell className="font-mono">{row.ticker}</TableCell>
                    <TableCell className="font-mono">{row.yahooTicker}</TableCell>
                    <TableCell>{row.reason}</TableCell>
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
