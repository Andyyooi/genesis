import { eq } from "drizzle-orm";
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { loadInstrumentSnapshots } from "@/db/queries";
import { instruments } from "@/db/schema";
import { latestAnnualObservation } from "@/lib/snapshot-dates";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { persistScoreRun } from "@/scoring/persist";
import { scoreFromMetrics } from "@/scoring/score";

export function scoreTicker(ticker: string, persist = true) {
  const data = loadInstrumentSnapshots(ticker);
  if (!data) return null;
  const instrumentType = data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const config = loadScoringConfig();
  const classified = resolveResearchProfile(
    instrumentType,
    data.instrument.ticker,
    { sector: data.instrument.sector, industry: data.instrument.industry },
    config,
  );
  if (data.instrument.researchProfile !== classified.profile) {
    getDb()
      .update(instruments)
      .set({ researchProfile: classified.profile, updatedAt: new Date().toISOString() })
      .where(eq(instruments.id, data.instrument.id))
      .run();
    data.instrument.researchProfile = classified.profile;
  }
  const asOf = new Date().toISOString();
  const metrics = snapshotsToMetrics({
    instrumentType,
    ticker: data.instrument.ticker,
    sector: data.instrument.sector,
    industry: data.instrument.industry,
    periods: data.periods,
    bars: data.bars,
    events: data.events,
    asOf,
  });
  const result = scoreFromMetrics({
    config,
    metrics,
    instrumentType,
    ticker: data.instrument.ticker,
    pn17: data.instrument.pn17,
    sector: data.instrument.sector,
    industry: data.instrument.industry,
    researchProfile: classified.profile,
    asOf,
    latestAnnual: latestAnnualObservation(data.periods),
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
    events: data.events,
    metrics,
    result,
  };
}
