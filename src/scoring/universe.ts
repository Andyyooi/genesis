import { eq } from "drizzle-orm";
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { loadDividendCoverage } from "@/db/dividends";
import { loadInstrumentSnapshots } from "@/db/queries";
import { instruments } from "@/db/schema";
import { usableAccounts } from "@/metrics/evidence";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { scoreUniverse, type ScoreInput } from "@/scoring/score";
import { persistScoreRun } from "@/scoring/persist";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import { buildValuationContext, clearPeerUniverseCache, loadPeerUniverse, periodsToSnapshots } from "@/scoring/valuation-context";

/** Called inside the market publication transaction; no network and no per-page ranking. */
export function persistUniverseScores(asOf: string) {
  if (isSnapshotReadOnly()) throw new Error("Cannot rescore a read-only snapshot");
  const db = getDb();
  const config = loadScoringConfig();
  clearPeerUniverseCache();
  const rows = db.select().from(instruments).all().filter((row) => row.listingStatus !== "inactive");
  const prepared = rows.map((instrument) => {
    const data = loadInstrumentSnapshots(instrument.ticker, true)!;
    const instrumentType = instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
    const classified = resolveResearchProfile(instrumentType, instrument.ticker, { sector: instrument.sector, industry: instrument.industry }, config);
    const metrics = snapshotsToMetrics({ ...data, instrumentType, ticker: instrument.ticker, sector: instrument.sector, industry: instrument.industry, events: [], dividendCoverage: loadDividendCoverage(instrument.id), asOf, config });
    const latest = usableAccounts(data.periods, asOf, config.reporting_lag_months).filter((p) => p.statementType === "annual").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
    const input: ScoreInput = { config, metrics, instrumentType, ticker: instrument.ticker, sector: instrument.sector, industry: instrument.industry, researchProfile: classified.profile, pn17: instrument.pn17, warning: instrument.warningFlag, bars: data.bars, asOf, latestAnnual: latest ?? null };
    return { instrument, metrics, input, data };
  });
  const dividends = new Map(prepared.map(({ instrument, metrics }) => [
    instrument.ticker,
    metrics.find((metric) => metric.id === "dividend_yield" && metric.available)?.inputs
      .find((input) => input.name === "dividendPerShare")?.value ?? null,
  ]));
  const peers = loadPeerUniverse().map((peer) => ({ ...peer, dividendPerShare: dividends.get(peer.ticker) ?? null }));
  const results = scoreUniverse(prepared.map((p) => p.input));
  for (const { instrument, metrics, data } of prepared) {
    const result = results.get(instrument.ticker)!;
    result.valuationContext = buildValuationContext({ ticker: instrument.ticker, researchProfile: result.researchProfile, industry: instrument.industry, sector: instrument.sector, periods: periodsToSnapshots(data.periods), bars: data.bars, metrics, peers, dataConfidence: result.dataConfidence, dataCoverage: result.dataCoverage });
    persistScoreRun({ instrumentId: instrument.id, result, metrics });
    if (instrument.researchProfile !== result.researchProfile) db.update(instruments).set({ researchProfile: result.researchProfile }).where(eq(instruments.id, instrument.id)).run();
  }
  return results;
}
