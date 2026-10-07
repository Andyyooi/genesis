"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDateSafe } from "@/lib/display";
import { formatMyr } from "@/lib/format-myr";
import {
  FAIR_VALUE_SECTION_DESCRIPTION,
  fairValueConfidenceText,
  fairValueDifferenceText,
  fairValueHasBase,
  fairValueHeroText,
  fairValueInputLabel,
  fairValueMethodSummary,
  fairValuePriceUsedText,
  fairValueRangeText,
  fairValueSampleText,
  formatFairValueInputValue,
  formatFairValueMultiple,
} from "@/lib/fair-value-presentation";
import { formatFreshnessBand } from "@/lib/research-copy";
import type { FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function MethodDetails({ method }: { method: FairValueMethodEvidence }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">Formula</dt>
        <dd>{method.formula}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{fairValueInputLabel(method)}</dt>
        <dd className="tabular-nums">{formatFairValueInputValue(method)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          {method.currentInputName === "dividend_per_share" ? "Yield" : "Multiple"}
        </dt>
        <dd className="tabular-nums">{formatFairValueMultiple(method)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">{method.kind === "peer" ? "Peer sample" : "Historical sample"}</dt>
        <dd>{fairValueSampleText(method)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Fundamentals period</dt>
        <dd>{formatDateSafe(method.fundamentalsPeriodEnd)}</dd>
      </div>
    </dl>
  );
}

export function EstimatedFairValue({ result }: { result: FairValueResult }) {
  const hasBase = fairValueHasBase(result);
  const range = fairValueRangeText(result);
  const used = result.methods.filter((method) => method.available);
  const skipped = result.methods.filter((method) => !method.available);
  const freshness = formatFreshnessBand(result.assumptions.freshness);
  const age =
    result.assumptions.freshnessAgeMonths == null
      ? ""
      : ` · ${result.assumptions.freshnessAgeMonths} months`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="estimated-fair-value-heading">
      <div>
        <h2 id="estimated-fair-value-heading" className="text-xl font-semibold tracking-tight">
          Estimated Fair Value
        </h2>
        <p className="text-sm text-muted-foreground">{FAIR_VALUE_SECTION_DESCRIPTION}</p>
      </div>
      <Card>
        <CardHeader>
          <p className={hasBase ? "text-4xl font-semibold tabular-nums" : "text-2xl font-semibold text-muted-foreground"}>
            {fairValueHeroText(result)}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2">
            {range ? <Detail label="Range" value={range} /> : null}
            <Detail label="Price used" value={fairValuePriceUsedText(result)} />
            <Detail
              label="Difference"
              value={hasBase ? fairValueDifferenceText(result.differenceVsPrice) : "Unavailable"}
            />
            <div>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="mt-1 flex flex-col gap-1">
                <Badge variant="outline">{result.confidence}</Badge>
                <span>{fairValueConfidenceText(result)}</span>
              </dd>
            </div>
            <Detail label="Fundamentals period" value={formatDateSafe(result.fundamentalsPeriodEnd)} />
            <Detail label="Freshness" value={`${freshness}${age}`} />
          </dl>

          {result.assumptions.historicalLimitation ? (
            <p className="text-muted-foreground">{result.assumptions.historicalLimitation}</p>
          ) : null}
          {result.assumptions.peerSelectionPath ? (
            <p className="text-muted-foreground">
              Peer set: {result.assumptions.peerGroupType ?? "Unavailable"} — {result.assumptions.peerSelectionPath}
              {result.assumptions.peerEligibleCount == null
                ? ""
                : ` · ${result.assumptions.peerEligibleCount} eligible`}
            </p>
          ) : null}

          {used.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">Methods used</h3>
              {used.map((method) => (
                <Collapsible key={method.id} defaultOpen={false} className="rounded-md border px-3 py-2">
                  <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left">
                    <span className="font-medium">{method.label}</span>
                    <span className="shrink-0 tabular-nums">{formatMyr(method.methodValue)}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 border-t pt-2 text-muted-foreground">
                    <MethodDetails method={method} />
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          ) : null}

          {skipped.length > 0 ? (
            <Collapsible defaultOpen={false} className="rounded-md border px-3 py-2">
              <CollapsibleTrigger className="w-full text-left font-medium">
                Unavailable · {skipped.length}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 border-t pt-2">
                <ul className="space-y-2 text-muted-foreground">
                  {skipped.map((method) => (
                    <li key={method.id}>{fairValueMethodSummary(method)}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {result.assumptions.excludedApproaches ? (
            <p className="text-muted-foreground">{result.assumptions.excludedApproaches}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">Model {result.modelVersion}</p>
        </CardContent>
      </Card>
    </section>
  );
}
