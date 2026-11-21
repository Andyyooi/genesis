import { financialTerm } from "@/lib/financial-terms";

export function FinancialTerm({ id, fallback }: { id: string; fallback?: string }) {
  const term = financialTerm(id, fallback);
  return <span className="block">
    <span>{term.label}</span>
    {term.technical !== term.label ? <span className="ml-1 text-xs text-muted-foreground">({term.technical})</span> : null}
    {term.explanation ? <span className="mt-1 block max-w-xl text-xs font-normal text-muted-foreground">{term.explanation}</span> : null}
  </span>;
}
