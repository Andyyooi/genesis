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
  /** Reported NAV / unit. Missing stays null — never invented. */
  navPerShare: number | null;
  /** Total assets for SC-style REIT gearing. Missing stays null. */
  totalAssets: number | null;
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

/** An older stored session whose close was left unchanged. */
export type PriceBarConflict = {
  ticker: string;
  barDate: string;
  storedClose: number;
  incomingClose: number;
};

export type EventsImportReport = {
  kind: "events";
  file: string;
  startedAt: string;
  finishedAt: string;
  accepted: number;
  upserted: number;
  rejected: RejectedRow[];
};

export type PricesImportReport = {
  kind: "prices";
  startedAt: string;
  finishedAt: string;
  succeeded: string[];
  failed: PriceImportFailure[];
  /** Rows written this run: new sessions and a revised latest session. */
  barsUpserted: number;
  /** Sessions that were not already stored, including a gap older than the latest bar. */
  barsInserted?: number;
  /** Stored sessions whose close already matched. Those rows were not rewritten. */
  barsReimported?: number;
  /** Older sessions whose incoming close differed. The stored close was kept. */
  conflicts?: PriceBarConflict[];
};
