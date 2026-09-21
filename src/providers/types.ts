import type { InstrumentType } from "@/db/schema";
import type { LineItems } from "@/ingest/types";
import type { YahooBar } from "@/ingest/providers/yahoo-prices";

export type InstrumentDraft = {
  ticker: string;
  bursaCode: string | null;
  yahooTicker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  listingBoard: string | null;
  instrumentType: InstrumentType;
  pn17: boolean;
  listingStatus: "listed" | "inactive";
  universeSource: string;
};

export type PriceBarDraft = YahooBar & { adjClose?: number | null };

export type FundamentalPeriodDraft = {
  periodEnd: string;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  fiscalPeriod?: string | null;
  statementType: string;
  source: string;
  availableAt: string | null;
  filingDate?: string | null;
  availableAtSource?: string | null;
  actualOrEstimate: "actual" | "estimate";
  lineItems: LineItems;
};

export interface UniverseProvider {
  readonly id: string;
  list(): Promise<InstrumentDraft[]>;
}

export interface PriceProvider {
  readonly id: string;
  dailyBars(yahooTicker: string, range?: string): Promise<PriceBarDraft[]>;
}

export interface FundamentalProvider {
  readonly id: string;
  annualPeriods(yahooTicker: string): Promise<FundamentalPeriodDraft[]>;
  profile?(yahooTicker: string): Promise<{ sector: string | null; industry: string | null }>;
}

export interface NewsProvider {
  readonly id: string;
  /** Phase 16+: return drafts via EventSourceProvider implementations instead. */
  list(yahooTicker: string): Promise<never[]>;
}
