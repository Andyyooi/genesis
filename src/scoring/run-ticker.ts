import { desc, eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { loadInstrumentSnapshots } from "@/db/queries";
import { scoreRuns } from "@/db/schema";
import { parseLineItemsJson } from "@/ingest/merge-line-items";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import { scoreFromMetrics } from "@/scoring/score";
import { fullYearDividendLabel } from "@/lib/dividend-yield";
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
      const legacy = metrics.find((metric) => metric.id === "dividend_yield" && metric.available && metric.formula === "latest annual DPS / last close");
      const periodEnd = legacy?.inputs.find(({ name }) => name === "dividendPerShare")?.period;
      if (legacy && periodEnd) {
        const reported = data.periods.find((period) => period.periodEnd === periodEnd && period.statementType === "annual" &&
          period.actualOrEstimate === "actual" && period.source !== "yahoo-quote-summary" &&
          parseLineItemsJson(period.lineItemsJson).dividendPerShare === legacy.inputs[0]?.value);
        const label = reported ? fullYearDividendLabel(periodEnd, reported.fiscalYear) : "Legacy saved yield (full year unverified)";
        legacy.period = label;
        for (const factor of result!.categories.flatMap(({ factors }) => factors)) {
          if (factor.metricId === "dividend_yield" && factor.available) factor.period = label;
        }
        for (const block of [result!.valuationContext.historical, result!.valuationContext.peer]) {
          const metric = block.metrics.find((row) => row.metricId === "dividend_yield" && row.current !== null);
          if (metric) {
            metric.dividendBasis = label;
            const previous = metric.fact;
            metric.fact = `${previous} Basis: ${label}.`;
            block.facts = block.facts.map((fact) => fact === previous ? metric.fact : fact);
          }
        }
      }
    }
  } catch { /* An unreadable legacy run is not a current percentile score. */ }
  if (!result) {
    result = scoreFromMetrics({ config: loadScoringConfig(), metrics: [], instrumentType, ticker: data.instrument.ticker, sector: data.instrument.sector, industry: data.instrument.industry, pn17: data.instrument.pn17, asOf: row?.asOf ?? new Date().toISOString() });
    result.notes = ["No published percentile score. Run npm run market:rescore on the writable research database, then publish a snapshot."];
  }
  return { ticker: data.instrument.ticker, name: data.instrument.name, instrumentType, pn17: data.instrument.pn17, ...data, events: [] as EventSnapshot[], metrics, result };
}
