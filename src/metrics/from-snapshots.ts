import type { LineItems } from "@/ingest/types";
import { computeMetrics } from "@/metrics/compute";
import type { EventSnapshot, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ScoringConfig } from "@/config/load-scoring";

type PeriodRow = {
  actualOrEstimate?: string;
  periodEnd: string;
  availableAt: string | null;
  statementType: string;
  source: string;
  fiscalQuarter: number | null;
  lineItemsJson: string | null;
};

type BarRow = {
  adjClose?: number | null;
  volume?: number | null;
  barDate: string;
  close: number | null;
  high: number | null;
  low: number | null;
};

function emptyItems(): LineItems & {
  grossProfit: number | null;
  operatingProfit: null;
  ebitda: null;
  ebit: number | null;
  interestExpense: null;
} {
  return {
    revenue: null,
    pat: null,
    eps: null,
    equity: null,
    totalDebt: null,
    cash: null,
    ocf: null,
    capex: null,
    shares: null,
    dividendPerShare: null,
    navPerShare: null,
    totalAssets: null,
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
  };
}

export function snapshotsToMetrics(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  ticker?: string | null;
  sector?: string | null;
  industry?: string | null;
  periods: PeriodRow[];
  bars: BarRow[];
  events?: EventSnapshot[];
  asOf?: string;
  config?: ScoringConfig;
}) {
  const periods: StatementSnapshot[] = args.periods.map((row) => {
    let items = emptyItems();
    if (row.lineItemsJson) {
      try {
        items = { ...items, ...(JSON.parse(row.lineItemsJson) as Partial<LineItems>) };
      } catch {
        items = emptyItems();
      }
    }
    return {
      periodEnd: row.periodEnd,
      availableAt: row.availableAt,
      statementType: row.statementType,
      source: row.source,
      fiscalQuarter: row.fiscalQuarter,
      actualOrEstimate: row.actualOrEstimate,
      ...items,
    };
  });

  const bars: PriceBarSnapshot[] = args.bars.map((bar) => ({
    barDate: bar.barDate,
    close: bar.close,
    high: bar.high,
    low: bar.low,
    adjClose: bar.adjClose,
    volume: bar.volume,
  }));

  const asOf = args.asOf ?? new Date().toISOString();
  const events = (args.events ?? []).filter((event) => {
    if (event.availableAt) return event.availableAt <= asOf;
    return event.occurredAt <= asOf;
  });

  return computeMetrics({
    instrumentType: args.instrumentType,
    ticker: args.ticker,
    sector: args.sector,
    industry: args.industry,
    periods,
    bars,
    events,
    asOf,
    config: args.config,
  });
}
