"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CategoryScore, FactorEvidence } from "@/scoring/types";
import { categoryTitle, formatScore100 } from "@/lib/research-copy";

function fmtValue(value: number | null): string {
  if (value === null) return "Data unavailable";
  return value.toLocaleString("en-MY", { maximumFractionDigits: 4 });
}

function FactorBlock({ factor }: { factor: FactorEvidence }) {
  return (
    <Collapsible className="rounded-md border px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left text-sm">
        <span className="font-medium">{factor.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {factor.available ? formatScore100(factor.score) : "Data unavailable"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 border-t pt-2 text-sm text-muted-foreground">
        <p>
          <span className="text-foreground">Formula / rule:</span> {factor.formula}
        </p>
        <p>
          <span className="text-foreground">Period:</span> {factor.period ?? "Data unavailable"}
        </p>
        {factor.reason ? (
          <p>
            <span className="text-foreground">Why unavailable:</span> {factor.reason}
          </p>
        ) : null}
        <div>
          <p className="text-foreground">Inputs</p>
          {factor.inputs.length === 0 ? (
            <p>Data unavailable</p>
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
      {categories.map((category) => (
        <Collapsible key={category.id} className="rounded-lg border">
          <CollapsibleTrigger className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
            <span className="font-medium">
              {categoryTitle(category)}{" "}
              <span className="font-normal text-muted-foreground">
                (configured {category.configuredWeight}%
                {category.inThisRun && category.liveWeight !== null
                  ? ` · ${Math.round(category.liveWeight * 100)}% of this run`
                  : ""}
                )
              </span>
            </span>
            <span className="tabular-nums">
              {formatScore100(category.score)}
              <span className="ml-2 text-sm text-muted-foreground">
                coverage {(category.coverage * 100).toFixed(0)}%
              </span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 border-t px-4 py-3">
            {category.warning ? (
              <p className="text-sm text-muted-foreground">{category.warning}</p>
            ) : null}
            {category.factors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No factors in this profile.</p>
            ) : (
              category.factors.map((factor) => <FactorBlock key={factor.id} factor={factor} />)
            )}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
