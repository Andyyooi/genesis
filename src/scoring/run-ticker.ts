import { desc, eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { loadInstrumentSnapshots } from "@/db/queries";
import { scoreRuns } from "@/db/schema";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import { scoreFromMetrics } from "@/scoring/score";
import type { ScoreResult } from "@/scoring/types";

/** Read the published universe result. The legacy arguments never trigger per-ticker scoring. */
export function scoreTicker(ticker: string, persist = false, opts?: { attachValuationContext?: boolean }) {
  void persist;
  void opts;
  const data = loadInstrumentSnapshots(ticker, true);
  if (!data) return null;
  const instrumentType = data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const row = getDb().select().from(scoreRuns).where(eq(scoreRuns.instrumentId, data.instrument.id)).orderBy(desc(scoreRuns.id)).get();
  let result: ScoreResult | null = null;
  let metrics: MetricValue[] = [];
  try {
    const evidence = JSON.parse(row?.evidenceJson ?? "{}");
    if (evidence.storedResult?.methodology === "cross-sectional-v2") {
      result = evidence.storedResult;
      evidence.storedResult.dataCoverage.notApplicable ??= 0;
      metrics = evidence.scoredMetrics ?? [];
    }
  } catch { /* An unreadable legacy run is not a current percentile score. */ }
  if (!result) {
    result = scoreFromMetrics({ config: loadScoringConfig(), metrics: [], instrumentType, ticker: data.instrument.ticker, sector: data.instrument.sector, industry: data.instrument.industry, pn17: data.instrument.pn17, asOf: row?.asOf ?? new Date().toISOString() });
    result.notes = ["No published percentile score. Run npm run market:rescore on the writable research database, then publish a snapshot."];
  }
  return { ticker: data.instrument.ticker, name: data.instrument.name, instrumentType, pn17: data.instrument.pn17, ...data, events: [] as EventSnapshot[], metrics, result };
}
