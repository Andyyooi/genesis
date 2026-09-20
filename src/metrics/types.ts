export type MetricUnit = "ratio" | "myr" | "percent" | "shares";

export type MetricInput = {
  name: string;
  value: number | null;
  period?: string | null;
};

export type MetricValue = {
  id: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  available: boolean;
  /** Why this is unavailable. Empty when available. */
  reason: string | null;
  /** Reporting period, bar date, or date range used. */
  period: string | null;
  inputs: MetricInput[];
  formula: string;
};

export type StatementSnapshot = {
  periodEnd: string;
  availableAt: string | null;
  statementType: string;
  source: string;
  fiscalQuarter: number | null;
  revenue: number | null;
  pat: number | null;
  eps: number | null;
  equity: number | null;
  totalDebt: number | null;
  cash: number | null;
  ocf: number | null;
  capex: number | null;
  shares: number | null;
  dividendPerShare: number | null;
  navPerShare: number | null;
  totalAssets: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  ebitda: number | null;
  ebit: number | null;
  interestExpense: number | null;
};

export type EventSnapshot = {
  occurredAt: string;
  availableAt: string | null;
  source: string;
  sourceUrl: string | null;
  headline: string;
  excerpt: string | null;
  classification: string;
  relevanceNote: string | null;
};

export type PriceBarSnapshot = {
  barDate: string;
  close: number | null;
  high: number | null;
  low: number | null;
};

export function unavailable(
  id: string,
  label: string,
  formula: string,
  reason: string,
  inputs: MetricInput[],
  period: string | null,
  unit: MetricUnit = "ratio",
): MetricValue {
  return {
    id,
    label,
    value: null,
    unit,
    available: false,
    reason,
    period,
    inputs,
    formula,
  };
}

export function available(
  id: string,
  label: string,
  value: number | null,
  unit: MetricUnit,
  formula: string,
  inputs: MetricInput[],
  period: string | null,
): MetricValue {
  return {
    id,
    label,
    value,
    unit,
    available: true,
    reason: null,
    period,
    inputs,
    formula,
  };
}
