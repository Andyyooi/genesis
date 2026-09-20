import Link from "next/link";
import { notFound } from "next/navigation";
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
import { loadInstrumentSnapshots } from "@/db/queries";
import type { LineItems } from "@/ingest/types";
import { formatMyr } from "@/lib/format-myr";

export const dynamic = "force-dynamic";

function parseLineItems(json: string | null): LineItems | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LineItems;
  } catch {
    return null;
  }
}

function fmt(value: number | null | undefined) {
  return formatMyr(value);
}

export default async function InspectPage({
  params,
}: PageProps<"/inspect/[ticker]">) {
  const { ticker } = await params;
  const data = loadInstrumentSnapshots(ticker);
  if (!data) notFound();

  const { instrument, periods, bars } = data;
  const recentBars = bars.slice(0, 30);
  const oldestBar = bars.at(-1);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Watchlist
        </Link>
        <span className="text-muted-foreground"> · inspect snapshots (not a research page)</span>
        {" · "}
        <Link href={`/metrics/${instrument.ticker}`} className="underline underline-offset-4">
          Metrics debug
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{instrument.name}</h1>
          <Badge variant={instrument.instrumentType === "REIT" ? "secondary" : "outline"}>
            {instrument.instrumentType}
          </Badge>
          {instrument.pn17 ? <Badge variant="destructive">PN17 — higher risk</Badge> : null}
        </div>
        <p className="text-muted-foreground">
          {instrument.ticker} · Bursa {instrument.bursaCode ?? "—"} · Yahoo{" "}
          {instrument.yahooTicker ?? "Data unavailable"}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Financial periods</CardTitle>
          <CardDescription>
            {periods.length} stored row{periods.length === 1 ? "" : "s"}. Empty cells were
            not filled in. Re-import the same ticker/period/statement/source to overwrite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No periods yet. Import{" "}
              <code className="font-mono">data/raw/fundamentals-sample.csv</code> or your own
              CSV.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period end</TableHead>
                  <TableHead>Available at</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">PAT</TableHead>
                  <TableHead className="text-right">Equity</TableHead>
                  <TableHead className="text-right">EPS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const items = parseLineItems(period.lineItemsJson);
                  return (
                    <TableRow key={period.id}>
                      <TableCell className="font-mono">{period.periodEnd}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {period.availableAt ?? "Data unavailable"}
                      </TableCell>
                      <TableCell>
                        {period.statementType} · {period.actualOrEstimate}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm" title={period.source}>
                        {period.source}
                      </TableCell>
                      <TableCell className="text-right">{fmt(items?.revenue)}</TableCell>
                      <TableCell className="text-right">{fmt(items?.pat)}</TableCell>
                      <TableCell className="text-right">{fmt(items?.equity)}</TableCell>
                      <TableCell className="text-right">
                        {items?.eps == null ? "Data unavailable" : items.eps.toFixed(4)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price series (Yahoo EOD)</CardTitle>
          <CardDescription>
            {bars.length} daily bars
            {oldestBar && bars[0]
              ? ` from ${oldestBar.barDate} to ${bars[0].barDate}`
              : ""}. Showing the latest 30. Last trade date is the newest bar, not “today”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentBars.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Yahoo bars stored. Run <code className="font-mono">npm run ingest:prices</code>.
              If Yahoo misses this ticker the import report will say so.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">Close</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBars.map((bar) => (
                  <TableRow key={bar.id}>
                    <TableCell className="font-mono">{bar.barDate}</TableCell>
                    <TableCell className="text-right">{fmt(bar.open)}</TableCell>
                    <TableCell className="text-right">{fmt(bar.high)}</TableCell>
                    <TableCell className="text-right">{fmt(bar.low)}</TableCell>
                    <TableCell className="text-right">{fmt(bar.close)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {bar.volume == null ? "Data unavailable" : bar.volume.toLocaleString("en-MY")}
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
