import { loadScoringConfig } from "@/config/load-scoring";
import { loadInstrumentSnapshots } from "@/db/queries";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { persistScoreRun } from "@/scoring/persist";
import { scoreFromMetrics } from "@/scoring/score";

export function scoreTicker(ticker: string, persist = true) {
  const data = loadInstrumentSnapshots(ticker);
  if (!data) return null;
  const instrumentType = data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const metrics = snapshotsToMetrics({
    instrumentType,
    periods: data.periods,
    bars: data.bars,
  });
  const config = loadScoringConfig();
  const result = scoreFromMetrics({
    config,
    metrics,
    instrumentType,
    pn17: data.instrument.pn17,
  });
  if (persist) {
    persistScoreRun({ instrumentId: data.instrument.id, result });
  }
  return {
    ticker: data.instrument.ticker,
    name: data.instrument.name,
    instrumentType,
    pn17: data.instrument.pn17,
    instrument: data.instrument,
    periods: data.periods,
    bars: data.bars,
    metrics,
    result,
  };
}
