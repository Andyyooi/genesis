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
import { isFiniteNumber } from "@/lib/display";
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
  if (!isFiniteNumber(value)) return "Unavailable";
  if (metricId === "dividend_yield" || metricId === "roe" || metricId === "book_nav_premium") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(2);
}

export function ValuationContextCard({ block }: { block: ValuationContextBlock }) {
  const title = block.kind === "historical" ? "Historical Context" : "Peer Context";
  const blurb =
    block.kind === "historical"
      ? "This name versus its own stored annuals. Separate from Absolute Valuation Score — not a buy signal."
      : "This name versus a constructed peer set. Separate from Absolute Valuation Score — not a cheapness verdict.";
  const quality = block.peerQuality;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
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
            {quality.groupType.replaceAll("_", " ")}
            {quality.selectionPath ? ` — ${quality.selectionPath}` : ""}.{" "}
            <span className="font-medium">{quality.usableCount} usable</span>
            {` of ${quality.eligibleCount} eligible (min ${quality.minRequired}).`}
          </p>
        ) : block.groupDescription ? (
          <p className="text-muted-foreground">{block.groupDescription}</p>
        ) : null}
        {block.limitation ? <p>{block.limitation}</p> : null}
        {block.lookAheadSafe ? (
          <p className="text-muted-foreground">
            Series uses filing availability dates (available_at) for price alignment.
          </p>
        ) : block.kind === "historical" ? (
          <p className="text-muted-foreground">
            Status {block.historicalValuationStatus.replaceAll("_", " ")}. Look-ahead-safe
            point-in-time P/E is only claimed when every series point has available_at.
          </p>
        ) : null}
        <p className="text-muted-foreground">
          Attached confidence {block.confidenceLevel ?? "Unavailable"} · freshness{" "}
          {block.freshness ?? "Unavailable"}
        </p>
        {block.kind === "peer" && quality && quality.metrics.length > 0 ? (
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
        {block.kind === "historical" && block.metrics.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">This name</TableHead>
                <TableHead className="text-right">Historical median</TableHead>
                <TableHead className="hidden sm:table-cell">Label</TableHead>
                <TableHead className="hidden sm:table-cell">Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {block.metrics.map((row) => (
                <TableRow key={row.metricId}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.metricId, row.current)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.metricId, row.median)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatContextHeadline(row.labelForMetric)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {row.sampleSize}
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
