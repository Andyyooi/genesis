import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatContextHeadline } from "@/lib/research-copy";
import type { ContextLabel, ValuationContextBlock } from "@/scoring/valuation-context";

function badgeVariant(
  label: ContextLabel,
): "default" | "secondary" | "outline" | "destructive" {
  if (label === "POSITIVE") return "secondary";
  if (label === "NEGATIVE") return "outline";
  if (label === "NEUTRAL") return "outline";
  return "outline";
}

function fmt(metricId: string, value: number | null): string {
  if (value === null) return "Data unavailable";
  if (metricId === "dividend_yield" || metricId === "roe" || metricId === "book_nav_premium") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(2);
}

export function ValuationContextCard({ block }: { block: ValuationContextBlock }) {
  const title = block.kind === "historical" ? "Historical Context" : "Peer Context";
  const blurb =
    block.kind === "historical"
      ? "This name versus its own stored annuals. It is not a second Valuation Score and not a buy signal."
      : "This name versus a constructed peer set. It is not a cheapness verdict and not a buy signal.";
  const quality = block.peerQuality;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <Badge variant={badgeVariant(block.label)}>{formatContextHeadline(block.label)}</Badge>
          {block.kind === "historical" ? (
            <Badge variant="outline">{block.historicalValuationStatus.replaceAll("_", " ")}</Badge>
          ) : quality ? (
            <Badge variant="outline">{quality.groupType.replaceAll("_", " ")}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {block.kind === "peer" && quality ? (
          <p>
            Peer group: <span className="font-medium">{quality.usableCount} usable peers</span>
            {` (${quality.eligibleCount} eligible, min ${quality.minRequired}). `}
            {quality.selectionPath}.
          </p>
        ) : block.groupDescription ? (
          <p className="text-muted-foreground">{block.groupDescription}</p>
        ) : null}
        {block.limitation ? <p>{block.limitation}</p> : null}
        {block.lookAheadSafe ? (
          <p className="text-muted-foreground">Series uses filing dates (available_at) for price alignment.</p>
        ) : block.kind === "historical" ? (
          <p className="text-muted-foreground">
            Status {block.historicalValuationStatus.replaceAll("_", " ")}. Look-ahead-safe
            point-in-time P/E is only claimed when every series point has available_at.
          </p>
        ) : null}
        <p className="text-muted-foreground">
          Data confidence {block.confidenceLevel ?? "not attached"} · freshness{" "}
          {block.freshness ?? "UNKNOWN"}
        </p>
        {block.kind === "peer" && quality && quality.metrics.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">This name</TableHead>
                <TableHead className="text-right">Peer median</TableHead>
                <TableHead className="hidden sm:table-cell">Vs median</TableHead>
                <TableHead className="hidden sm:table-cell">Usable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quality.metrics.map((row) => (
                <TableRow key={row.metricId}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.metricId, row.subject)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.metricId, row.median)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {row.vsMedian.replaceAll("_", " ")}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {row.usableCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        <ul className="list-disc space-y-2 pl-5">
          {block.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
