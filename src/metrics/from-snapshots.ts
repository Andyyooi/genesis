import type { LineItems } from "@/ingest/types";
import { computeMetrics } from "@/metrics/compute";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";

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
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
  };
}

export function snapshotsToMetrics(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  periods: PeriodRow[];
  bars: BarRow[];
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

  return computeMetrics({
    instrumentType: args.instrumentType,
    periods,
    bars,
  });
}
