import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Disclosure({ title, hint, children, open = false }: {
  title: string; hint?: string; children: ReactNode; open?: boolean;
}) {
  return <details className="research-disclosure group/disclosure" open={open}>
    <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 sm:px-5">
      <span><span className="block font-semibold">{title}</span>{hint ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{hint}</span> : null}</span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-180" />
    </summary>
    <div className="flex flex-col gap-4 border-t p-4 sm:p-5">{children}</div>
  </details>;
}
