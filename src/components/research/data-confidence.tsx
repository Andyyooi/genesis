import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCoverageSummary } from "@/scoring/confidence";
import type { ScoreResult } from "@/scoring/types";
import { formatFreshnessBand, formatScore100, scoreEmphasisMuted } from "@/lib/research-copy";
import { cn } from "cn";

export function confidenceBadgeVariant(
  level: ScoreResult["dataConfidence"]["level"],
): "default" | "secondary" | "outline" | "destructive" {
  if (level === "HIGH") return "secondary";
  if (level === "MEDIUM") return "outline";
  if (level === "LOW") return "outline";
  return "destructive";
}

export function ScoreWithConfidence({
  result,
  kind,
}: {
  result: ScoreResult;
  kind: "research" | "valuation";
}) {
  const muted = scoreEmphasisMuted(result);
  const value = kind === "research" ? result.researchScore : result.valuationScore;
  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "font-semibold tabular-nums",
          muted ? "text-2xl text-muted-foreground" : "text-4xl",
        )}
      >
        {formatScore100(value)}
      </p>
      <p className="text-sm text-muted-foreground">
        Data confidence {result.dataConfidence.level}
        {result.dataConfidence.needsVerification ? " · needs verification" : ""}
      </p>
    </div>
  );
}

export function DataConfidenceCard({ result }: { result: ScoreResult }) {
  const c = result.dataCoverage;
  const d = result.dataConfidence;
  return (
    <Card className={d.needsVerification ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Data Confidence
          <Badge variant={confidenceBadgeVariant(d.level)}>{d.level}</Badge>
        </CardTitle>
        <CardDescription>
          Separate from Research and Valuation. A {d.level.toLowerCase().replaceAll("_", " ")}{" "}
          100 is not stronger than a high-confidence 78. This is a label, not a precision
          percentage.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>{formatCoverageSummary(c)}</p>
        <p>
          Freshness {formatFreshnessBand(c.freshness)}
          {c.ageMonths != null ? ` · ${c.ageMonths} months` : ""}
          {c.periodEnd ? ` · period-end ${c.periodEnd}` : ""}
          {c.availableAt ? ` · filed ${c.availableAt}` : ""}
        </p>
        <p className="text-muted-foreground">
          Fresh factors {c.freshCount} · aging {c.agingCount} · stale {c.staleCount} · very stale{" "}
          {c.veryStaleCount} · period unknown {c.unknownCount}. Unavailable is not scored as 0.
        </p>
        {d.needsVerification ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            High score — needs verification. Raw scores are unchanged; coverage or freshness is
            thin.
          </p>
        ) : null}
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {d.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
