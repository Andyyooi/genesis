import { ArrowDownRight, ArrowUpRight, Search, Tag } from "lucide-react";
import { StockNewsSection } from "@/components/news-headlines";
import { DividendHistory } from "@/components/research/dividend-history";
import type { buildStockBrief } from "@/lib/stock-brief";

function BriefItems({ items, limit = 3 }: { items: string[]; limit?: number }) {
  return <>
    <ul className="list-disc space-y-1 pl-4">
      {items.slice(0, limit).map(item => <li key={item}>{item}</li>)}
    </ul>
    {items.length > limit ? (
      <details className="text-muted-foreground">
        <summary className="cursor-pointer underline underline-offset-4">Show more</summary>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {items.slice(limit).map(item => <li key={item}>{item}</li>)}
        </ul>
      </details>
    ) : null}
  </>;
}

export function StockBrief({ brief, ticker }: { brief: ReturnType<typeof buildStockBrief>; ticker: string }) {
  return (
    <section aria-labelledby="stock-brief-heading" className="market-card overflow-hidden">
      <div className="space-y-1 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 id="stock-brief-heading" className="text-lg font-semibold">At a glance</h2>
          {brief.periodEnd ? <p className="text-xs text-muted-foreground">Saved accounts: year ended {brief.periodEnd}</p> : null}
        </div>
        <p className="text-sm">
          {brief.business}{" "}
          {brief.businessSource ? <a className="text-xs text-muted-foreground underline underline-offset-2" href={brief.businessSource}>Source</a> : null}
        </p>
      </div>
      <div className="grid items-stretch gap-px border-t bg-border sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5 bg-card p-4 text-sm sm:px-5">
          <h3 className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
            <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /> What looks good
          </h3>
          {brief.positives.length ? <BriefItems items={brief.positives} /> : <p>No clear strength stood out in the saved accounts.</p>}
        </div>
        <div className="min-w-0 space-y-1.5 bg-card p-4 text-sm sm:px-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Tag aria-hidden="true" className="size-4 shrink-0" /> Price and income
          </h3>
          <p>{brief.pricing}</p>
          <p><strong>Similar companies:</strong> {brief.peers}</p>
          <p className="text-muted-foreground">{brief.dividend}</p>
          <DividendHistory key={ticker} ticker={ticker} />
        </div>
        <div className="min-w-0 space-y-1.5 bg-card p-4 text-sm sm:px-5">
          <h3 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
            <ArrowDownRight aria-hidden="true" className="size-4 shrink-0" /> What to be careful about
          </h3>
          {brief.risks.length ? <BriefItems items={brief.risks} /> : !brief.priceDrop ? <p>No specific warning surfaced in these checks. That doesn’t guarantee safety.</p> : null}
          {brief.priceDrop ? <p>{brief.priceDrop}</p> : null}
          <StockNewsSection key={ticker} ticker={ticker} />
        </div>
        <div className="min-w-0 space-y-1.5 bg-card p-4 text-sm sm:px-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Search aria-hidden="true" className="size-4 shrink-0" /> What to watch next
          </h3>
          <BriefItems items={brief.watch} limit={2} />
        </div>
      </div>
    </section>
  );
}
