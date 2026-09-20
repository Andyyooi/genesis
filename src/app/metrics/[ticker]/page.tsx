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
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { formatMetricValue } from "@/lib/format-metric";

export const dynamic = "force-dynamic";

export default async function MetricsDebugPage({
  params,
}: PageProps<"/metrics/[ticker]">) {
  const { ticker } = await params;
  const data = loadInstrumentSnapshots(ticker);
  if (!data) notFound();

  const instrumentType = data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const metrics = snapshotsToMetrics({
    instrumentType,
    periods: data.periods,
    bars: data.bars,
  });
  const availableCount = metrics.filter((m) => m.available).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Watchlist
        </Link>
        {" · "}
        <Link href={`/inspect/${data.instrument.ticker}`} className="underline underline-offset-4">
          Snapshots
        </Link>
        <span className="text-muted-foreground"> · metrics debug (no scores)</span>
      </p>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{data.instrument.ticker} metrics</h1>
          <Badge variant={instrumentType === "REIT" ? "secondary" : "outline"}>{instrumentType}</Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Pure functions over stored snapshots. {availableCount} of {metrics.length} metrics have
          inputs. Missing inputs stay unavailable — never filled with zero. This is not a research
          score.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Computed metrics</CardTitle>
          <CardDescription>CLI: npm run metrics -- {data.instrument.ticker}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Formula</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((metric) => (
                <TableRow key={metric.id}>
                  <TableCell className="font-medium">{metric.label}</TableCell>
                  <TableCell className="tabular-nums">{formatMetricValue(metric)}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {metric.period ?? "—"}
                  </TableCell>
                  <TableCell>
                    {metric.available ? (
                      <Badge variant="outline">Available</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">{metric.reason}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground md:table-cell">
                    {metric.formula}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
