import type { LineItems } from "@/ingest/types";
import { buildSnapshotDates, latestAnnualPeriod, type SnapshotDates } from "@/lib/snapshot-dates";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import type { ScoreResult } from "@/scoring/types";
import { scoreTicker } from "@/scoring/run-ticker";

export const EXPORT_SCHEMA = "bursa-research.score-export.v1";

export type FinancialPeriodExport = {
  period_end: string;
  available_at: string | null;
  retrieved_at: string;
  statement_type: string;
  source: string;
  actual_or_estimate: string;
  line_items: LineItems | null;
};

export type ExportPayload = {
  schema: typeof EXPORT_SCHEMA;
  disclaimer: string;
  instrument: {
    ticker: string;
    name: string;
    instrument_type: "COMMON_STOCK" | "REIT";
    bursa_code: string | null;
    sector: string | null;
    pn17: boolean;
    research_profile?: string | null;
    currency: string;
  };
  /** Score-run calendar date vs stored filing period vs last trade. */
  dates: SnapshotDates;
  /** Same ScoreResult object a later in-app chatbot should consume. */
  score: ScoreResult;
  metrics: MetricValue[];
  financial_periods: FinancialPeriodExport[];
  events: EventSnapshot[];
};

export function unavailableLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Data unavailable";
  return String(value);
}

export function buildExportPayload(ticker: string): ExportPayload | null {
  const scored = scoreTicker(ticker, false);
  if (!scored) return null;
  const instrumentType = scored.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const lastTrade = scored.metrics.find((m) => m.id === "last_trade_date");
  const financial_periods = scored.periods.map((row) => {
    let line_items: LineItems | null = null;
    if (row.lineItemsJson) {
      try {
        line_items = JSON.parse(row.lineItemsJson) as LineItems;
      } catch {
        line_items = null;
      }
    }
    return {
      period_end: row.periodEnd,
      available_at: row.availableAt,
      retrieved_at: row.retrievedAt,
      statement_type: row.statementType,
      source: row.source,
      actual_or_estimate: row.actualOrEstimate,
      line_items,
    };
  });
  return {
    schema: EXPORT_SCHEMA,
    disclaimer:
      "Decision-support research only. Not a buy or sell recommendation. Missing values are null or labelled Data unavailable; they are never invented.",
    instrument: {
      ticker: scored.instrument.ticker,
      name: scored.instrument.name,
      instrument_type: instrumentType,
      bursa_code: scored.instrument.bursaCode,
      sector: scored.instrument.sector,
      pn17: scored.instrument.pn17,
      research_profile: scored.result.researchProfile,
      currency: scored.instrument.currency,
    },
    dates: buildSnapshotDates({
      scoreAsOf: scored.result.asOf,
      lastTradeDate: lastTrade?.period ?? null,
      fundamentalsPeriod: latestAnnualPeriod(scored.periods),
    }),
    score: scored.result,
    metrics: scored.metrics,
    financial_periods,
    events: scored.events,
  };
}
