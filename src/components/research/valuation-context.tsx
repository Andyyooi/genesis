import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function ValuationContextCard({ block }: { block: ValuationContextBlock }) {
  const title = block.kind === "historical" ? "Historical Context" : "Peer Context";
  const blurb =
    block.kind === "historical"
      ? "This name versus its own stored annuals. It is not a second Valuation Score and not a buy signal."
      : "This name versus a constructed peer set. It is not a cheapness verdict and not a buy signal.";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          <Badge variant={badgeVariant(block.label)}>{formatContextHeadline(block.label)}</Badge>
          {block.kind === "historical" ? (
            <Badge variant="outline">{block.historicalValuationStatus.replaceAll("_", " ")}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {block.groupDescription ? (
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
        <ul className="list-disc space-y-2 pl-5">
          {block.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
