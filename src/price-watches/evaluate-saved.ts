import { loadWatchCloses, loadWatchInstrument, loadWatchRange } from "@/price-watches/snapshot";
import { evaluatePriceWatch, type PriceWatch } from "@/price-watches/watch";

export function evaluateSavedWatch(watch: PriceWatch, instrumentId = loadWatchInstrument(watch.ticker)?.id) {
  const [latest, previous] = instrumentId === undefined ? [] : loadWatchCloses(instrumentId);
  const range = instrumentId !== undefined && watch.kind === "fair-range" ? loadWatchRange(instrumentId) : undefined;
  return { watch, latest, range, result: evaluatePriceWatch(watch, latest, previous, range) };
}
