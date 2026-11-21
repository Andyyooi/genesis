import { Disclosure } from "./disclosure";
import { StatusLabel } from "./status-label";
import { EstimatedFairValue } from "@/components/research/estimated-fair-value";
import type { FairValueRunRead } from "@/fair-value/load-run";

export function PersistedFairValue({ stored }: { stored: FairValueRunRead | null }) {
  if (!stored?.ok) return <section className="rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">Fair value</h2><div className="my-2"><StatusLabel level="LOW">Unavailable · value withheld</StatusLabel></div><p>No readable persisted quality assessment. Point fair value is withheld. Use Refresh data to publish an assessed result.</p>{stored ? <p>{stored.message}</p> : null}</section>;
  const { quality, result, calculatedAt } = stored.run;
  const reasons = [...quality.methods.flatMap((method) => [...method.flags, ...method.notes].map((reason) => reason.text)), ...quality.notes.map((note) => note.text)];
  const usable = quality.status === "CLEAR" && quality.baseUse === "POINT_OK";
  return <section className="flex flex-col gap-3 rounded-lg border p-4">
    <h2 className="text-xl font-semibold">Fair value</h2><StatusLabel level={usable ? "HIGH" : "LOW"}>{quality.status} · {usable ? "Quality checks passed" : "Point value withheld"}</StatusLabel>
    <Disclosure title="Quality checks & valuation details">
    <p className="text-sm text-muted-foreground">Stored assessment {calculatedAt} · {quality.baseUse.replaceAll("_", " ")}</p>
    {reasons.length ? <ul className="list-inside list-disc text-sm">{[...new Set(reasons)].map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>No quality flags recorded.</p>}
    {quality.historicalLimitation ? <p className="text-sm">{quality.historicalLimitation}</p> : null}
    {usable ? <EstimatedFairValue result={result} /> : <p className="font-semibold">Point fair value is not usable and is withheld. This safety check is not a valuation recommendation.</p>}
    </Disclosure>
  </section>;
}
