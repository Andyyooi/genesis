import { getPriceWatchStore, WATCH_STORE_UNAVAILABLE, WATCH_STORE_UNCONFIGURED } from "@/price-watches/store";
import type { PriceWatch } from "@/price-watches/watch";
import { PriceWatchEditor } from "./price-watch-editor";

export async function StockPriceWatch({ ticker }: { ticker: string }) {
  const store = getPriceWatchStore();
  let watch: PriceWatch | null = null;
  let error = store ? null : WATCH_STORE_UNCONFIGURED;
  try {
    if (store) watch = await store.get(ticker);
  } catch {
    error = WATCH_STORE_UNAVAILABLE;
  }
  return (
    <section className="market-card min-w-0 p-4">
      <h2 className="mb-1 font-semibold">Price watch</h2>
      {error ? <p className="text-sm text-muted-foreground">{error}</p>
        : <PriceWatchEditor key={ticker} ticker={ticker} initialWatch={watch} />}
    </section>
  );
}
