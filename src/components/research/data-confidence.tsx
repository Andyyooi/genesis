import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCoverageSummary } from "@/scoring/confidence";
import type { ScoreResult } from "@/scoring/types";
import { formatFreshnessBand, formatScore100, scoreEmphasisMuted } from "@/lib/research-copy";
import { researchScoreBlurb } from "@/lib/research-presentation";
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
        Confidence {result.dataConfidence.level}
        {result.dataConfidence.needsVerification ? " · needs verification" : ""}
      </p>
    </div>
  );
}

export function ResearchScoreCard({ result }: { result: ScoreResult }) {
  const c = result.dataCoverage;
  return (
    <Card className={result.dataConfidence.needsVerification ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle>Research Score</CardTitle>
        <CardDescription>{researchScoreBlurb(result)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ScoreWithConfidence result={result} kind="research" />
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd className="font-medium">{result.dataConfidence.level}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Coverage</dt>
            <dd className="font-medium">
              {Math.round(c.coverageRatio * 100)}% ({c.available}/{c.expected})
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Freshness</dt>
            <dd className="font-medium">{formatFreshnessBand(c.freshness)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function DataQualitySection({ result }: { result: ScoreResult }) {
  const c = result.dataCoverage;
  const d = result.dataConfidence;
  const pitSafe = Boolean(c.availableAt);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Data Quality</h2>
        <p className="text-sm text-muted-foreground">
          Separate from Research Score and Absolute Valuation. A high score with thin coverage is
          not stronger evidence than a moderate score with fuller, fresher data.
        </p>
      </div>
      <Card className={d.needsVerification ? "border-destructive/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Overall confidence
            <Badge variant={confidenceBadgeVariant(d.level)}>{d.level}</Badge>
            {d.needsVerification ? <Badge variant="destructive">Needs verification</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-medium">Coverage</p>
              <p className="text-muted-foreground">{formatCoverageSummary(c)}</p>
            </div>
            <div>
              <p className="font-medium">Freshness</p>
              <p className="text-muted-foreground">
                {formatFreshnessBand(c.freshness)}
                {c.ageMonths != null ? ` · ${c.ageMonths} months` : ""}
                {c.periodEnd ? ` · period-end ${c.periodEnd}` : ""}
              </p>
            </div>
            <div>
              <p className="font-medium">Point-in-time safety</p>
              <p className="text-muted-foreground">
                {pitSafe
                  ? `Filing availability known (${c.availableAt}).`
                  : "Filing availability (available_at) unknown for the latest annual — period-end only; not claimed as look-ahead-safe PIT."}
              </p>
            </div>
            <div>
              <p className="font-medium">Factor age mix</p>
              <p className="text-muted-foreground">
                Fresh {c.freshCount} · aging {c.agingCount} · stale {c.staleCount} · very stale{" "}
                {c.veryStaleCount} · period unknown {c.unknownCount}
              </p>
            </div>
          </div>
          {d.needsVerification ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              High score with thin coverage or stale inputs. Raw scores are unchanged; treat them
              carefully.
            </p>
          ) : null}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {d.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
