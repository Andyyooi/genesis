"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CategoryScore, FactorEvidence } from "@/scoring/types";
import { categoryTitle, formatScore100 } from "@/lib/research-copy";
import { factorAvailabilityLabel, liveWeightLabel } from "@/lib/research-presentation";

function fmtValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString("en-MY", { maximumFractionDigits: 4 });
}

function FactorBlock({ factor }: { factor: FactorEvidence }) {
  return (
    <Collapsible className="rounded-md border px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left text-sm">
        <span>
          <span className="font-medium">{factor.label}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {factorAvailabilityLabel(factor.available, factor.reason)}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {factor.available ? formatScore100(factor.score) : "Unavailable"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 border-t pt-2 text-sm text-muted-foreground">
        <p>
          <span className="text-foreground">Evidence / rule:</span> {factor.formula}
        </p>
        <p>
          <span className="text-foreground">Period:</span> {factor.period ?? "Unavailable"}
        </p>
        {!factor.available ? (
          <p>
            <span className="text-foreground">Why unavailable:</span>{" "}
            {factor.reason?.trim() || "Insufficient data"}
          </p>
        ) : null}
        <div>
          <p className="text-foreground">Inputs</p>
          {factor.inputs.length === 0 ? (
            <p>Unavailable</p>
          ) : (
            <ul className="list-disc pl-5">
              {factor.inputs.map((input) => (
                <li key={`${input.name}-${input.period ?? ""}`}>
                  {input.name}: {fmtValue(input.value)}
                  {input.period ? ` (${input.period})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        {factor.notes ? <p>{factor.notes}</p> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function CategoryDisclosure({ categories }: { categories: CategoryScore[] }) {
  return (
    <div className="space-y-3">
      {categories.map((category) => {
        const availableFactors = category.factors.filter((f) => f.available);
        const missingFactors = category.factors.filter((f) => !f.available);
        return (
          <Collapsible key={category.id} defaultOpen={category.inThisRun} className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
              <span>
                <span className="font-medium">{categoryTitle(category)}</span>
                <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                  Configured {category.configuredWeight}% · {liveWeightLabel(category)}
                </span>
              </span>
              <span className="tabular-nums">
                {category.inThisRun ? formatScore100(category.score) : "Unavailable"}
                <span className="ml-2 text-sm text-muted-foreground">
                  coverage {(category.coverage * 100).toFixed(0)}%
                </span>
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t px-4 py-3">
              {category.warning ? (
                <p className="text-sm text-muted-foreground">{category.warning}</p>
              ) : null}
              {!category.inThisRun ? (
                <p className="text-sm text-muted-foreground">
                  Not included in this Research Score run. Weights were renormalized across remaining
                  live categories.
                </p>
              ) : null}
              {category.factors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No factors in this profile.</p>
              ) : (
                <>
                  {availableFactors.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Available evidence
                      </p>
                      {availableFactors.map((factor) => (
                        <FactorBlock key={factor.id} factor={factor} />
                      ))}
                    </div>
                  ) : null}
                  {missingFactors.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Unavailable — insufficient data
                      </p>
                      {missingFactors.map((factor) => (
                        <FactorBlock key={factor.id} factor={factor} />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
