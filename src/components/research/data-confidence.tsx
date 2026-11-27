import { Disclosure } from "./disclosure";
import { FinancialTerm } from "./financial-term";
import { StatusLabel } from "./status-label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScoreResult } from "@/scoring/types";
import { dataConfidenceLabel, formatFreshnessBand, formatScore100, scoreEmphasisMuted, warningPenaltySummary } from "@/lib/research-copy";
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
    </div>
  );
}

export function ResearchScoreCard({ result }: { result: ScoreResult }) {
  const c = result.dataCoverage;
  const warningDeduction = warningPenaltySummary(result);
  return (
    <Card className={result.dataConfidence.needsVerification ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle>Research Score</CardTitle>
        <CardDescription>Evidence-based score, not a buy or sell signal.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ScoreWithConfidence result={result} kind="research" />
        {warningDeduction ? <p className="text-sm text-amber-800">{warningDeduction}</p> : null}
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground"><FinancialTerm id="data_confidence" /></dt>
            <dd className="mt-1"><StatusLabel level={result.dataConfidence.level}>{dataConfidenceLabel(result.dataConfidence.level)}</StatusLabel></dd>
          </div>
          <div>
            <dt className="text-muted-foreground"><FinancialTerm id="coverage" /></dt>
            <dd className="font-medium">
              {c.available} of {c.expected} checks ({Math.round(c.coverageRatio * 100)}%)
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground"><FinancialTerm id="freshness" /></dt>
            <dd className="mt-1"><StatusLabel level={c.freshness}>{formatFreshnessBand(c.freshness)}</StatusLabel></dd>
          </div>
        </dl>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm"><StatusLabel level={result.eligibility?.eligible ? "eligible" : "excluded"}>{result.eligibility?.eligible ? "Eligible for research lists" : "Excluded from recommendations"}</StatusLabel>
          {result.dataConfidence.needsVerification ? <p className="mt-2 font-medium text-amber-800">Needs verification — check coverage and account age.</p> : null}
          <details className="mt-2"><summary className="cursor-pointer text-primary">Why this status?</summary>
          <ul className="list-disc pl-5">
            {(result.eligibility?.reasons ?? ["Eligibility not verified; run market:rescore."]).map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="text-muted-foreground">Eligibility does not alter the score. Research lists are not buy or sell advice.</p><p className="mt-2 text-muted-foreground">{researchScoreBlurb(result)}</p></details>
        </div>
      </CardContent>
    </Card>
  );
}

export function DataQualitySection({ result }: { result: ScoreResult }) {
  const c = result.dataCoverage;
  const d = result.dataConfidence;
  const pitSafe = Boolean(c.availableAt);
  return (
    <Disclosure title="Data quality" hint={`${dataConfidenceLabel(d.level)} trust in evidence · ${c.available} of ${c.expected} checks have data · accounts: ${formatFreshnessBand(c.freshness)}`}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Data Quality</h2>
        <p className="text-sm text-muted-foreground">
          Separate from Research Score and Relative Value. A high score with thin coverage is
          not stronger evidence than a moderate score with fuller, fresher data.
        </p>
      </div>
      <Card className={d.needsVerification ? "border-destructive/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Coverage and accounts freshness
            {d.needsVerification ? <Badge variant="destructive">Needs verification</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-medium"><FinancialTerm id="coverage" /></p>
              <p className="text-muted-foreground">{c.available} of {c.expected} checks have usable data ({Math.round(c.coverageRatio * 100)}%). Missing checks are left out, never scored as zero.</p>
            </div>
            <div>
              <p className="font-medium"><FinancialTerm id="freshness" /></p>
              <p className="text-muted-foreground">
                {formatFreshnessBand(c.freshness)}
                {c.ageMonths != null ? ` · ${c.ageMonths} months` : ""}
                {c.periodEnd ? ` · period-end ${c.periodEnd}` : ""}
              </p>
            </div>
            <div>
              <p className="font-medium">Can we tell when investors first had these accounts? (Point-in-time safety)</p>
              <p className="text-muted-foreground">
                {pitSafe
                  ? `Filing availability known (${c.availableAt}).`
                  : "We know the year-end, but not when the latest accounts became public. Historical comparisons may therefore use information investors did not yet have."}
              </p>
            </div>
            <div>
              <p className="font-medium">Age of the evidence behind the checks</p>
              <p className="text-muted-foreground">
                Fresh {c.freshCount} · aging {c.agingCount} · stale {c.staleCount} · very stale{" "}
                {c.veryStaleCount} · period unknown {c.unknownCount}
              </p>
            </div>
          </div>
          {d.needsVerification ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              Thin coverage or stale accounts. The stored score is unchanged; verify the underlying evidence.
            </p>
          ) : null}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {d.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Disclosure>
  );
}
