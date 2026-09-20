export type LineItems = {
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
};

export type RejectedRow = {
  rowNumber: number;
  ticker: string | null;
  reason: string;
};

export type FundamentalsImportReport = {
  kind: "fundamentals";
  file: string;
  startedAt: string;
  finishedAt: string;
  accepted: number;
  upserted: number;
  rejected: RejectedRow[];
};

export type PriceImportFailure = {
  ticker: string;
  yahooTicker: string;
  reason: string;
};

export type PricesImportReport = {
  kind: "prices";
  startedAt: string;
  finishedAt: string;
  succeeded: string[];
  failed: PriceImportFailure[];
  barsUpserted: number;
};
