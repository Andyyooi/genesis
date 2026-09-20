import type { LineItems } from "@/ingest/types";
import { computeMetrics } from "@/metrics/compute";
import type { EventSnapshot, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";

type PeriodRow = {
  periodEnd: string;
  availableAt: string | null;
  statementType: string;
  source: string;
  fiscalQuarter: number | null;
  lineItemsJson: string | null;
};

type BarRow = {
  barDate: string;
  close: number | null;
  high: number | null;
  low: number | null;
};

function emptyItems(): LineItems & {
  grossProfit: null;
  operatingProfit: null;
  ebitda: null;
  ebit: null;
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
  periods: PeriodRow[];
  bars: BarRow[];
  events?: EventSnapshot[];
  asOf?: string;
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
      ...items,
    };
  });

  const bars: PriceBarSnapshot[] = args.bars.map((bar) => ({
    barDate: bar.barDate,
    close: bar.close,
    high: bar.high,
    low: bar.low,
  }));

  const asOf = args.asOf ?? new Date().toISOString();
  const events = (args.events ?? []).filter((event) => {
    if (event.availableAt) return event.availableAt <= asOf;
    return event.occurredAt <= asOf;
  });

  return computeMetrics({
    instrumentType: args.instrumentType,
    ticker: args.ticker,
    periods,
    bars,
    events,
  });
}
