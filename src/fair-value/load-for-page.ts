import Database from "better-sqlite3";
import { liveSqlitePath, resolveSqliteFile } from "@/db/snapshot-file";
import { calculateFairValue } from "@/fair-value/orchestrate";
import type { FairValueResult } from "@/fair-value/types";
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import type { PriceBarSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import type { PeerUniverseRow } from "@/scoring/peer-group";
import { periodsToSnapshots } from "@/scoring/valuation-context";

type InstrumentRow = {
  id: number;
  ticker: string;
  name: string;
  listingStatus: string | null;
  instrumentType: string | null;
  researchProfile: string | null;
  industry: string | null;
  sector: string | null;
};

/**
 * Read stored snapshots and return the orchestrated Fair Value result.
 * Does not persist, refresh, score, or call a market-data API.
 */
export function loadFairValueForPage(ticker: string, asOf = new Date().toISOString()): FairValueResult | null {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return null;
  const db = openReadOnly();
  if (!db) return null;
  try {
    const instrument = db
      .prepare(
        `SELECT id, ticker, name, listing_status as listingStatus, instrument_type as instrumentType,
                research_profile as researchProfile, industry, sector
         FROM instruments WHERE ticker = ?`,
      )
      .get(symbol) as InstrumentRow | undefined;
    if (!instrument) return null;

    const instrumentType = instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
    const classified = resolveResearchProfile(
      instrumentType,
      instrument.ticker,
      { sector: instrument.sector, industry: instrument.industry },
      loadScoringConfig(),
    );

    const periodRows = db
      .prepare(
        `SELECT period_end as periodEnd, available_at as availableAt, statement_type as statementType,
                source, fiscal_quarter as fiscalQuarter, line_items_json as lineItemsJson
         FROM financial_periods WHERE instrument_id = ?`,
      )
      .all(instrument.id) as {
      periodEnd: string;
      availableAt: string | null;
      statementType: string;
      source: string;
      fiscalQuarter: number | null;
      lineItemsJson: string | null;
    }[];
    const barRows = db
      .prepare(
        `SELECT bar_date as barDate, close, high, low FROM price_bars WHERE instrument_id = ?`,
      )
      .all(instrument.id) as PriceBarSnapshot[];

    return calculateFairValue({
      ticker: instrument.ticker,
      researchProfile: classified.profile,
      industry: instrument.industry,
      sector: instrument.sector,
      periods: periodsToSnapshots(periodRows),
      bars: barRows,
      peers: loadPeerRows(db),
      asOf,
    });
  } finally {
    db.close();
  }
}

function openReadOnly(): Database.Database | null {
  try {
    const path = isSnapshotReadOnly() ? resolveSqliteFile().path : liveSqlitePath();
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function loadPeerRows(db: Database.Database): PeerUniverseRow[] {
  const names = db
    .prepare(
      `SELECT id, ticker, name, listing_status as listingStatus, instrument_type as instrumentType,
              research_profile as researchProfile, industry, sector FROM instruments`,
    )
    .all() as InstrumentRow[];
  const lastBars = db
    .prepare(
      `SELECT p.instrument_id as instrumentId, p.bar_date as barDate, p.close as close
       FROM price_bars p
       INNER JOIN (
         SELECT instrument_id, MAX(bar_date) as d FROM price_bars WHERE close IS NOT NULL GROUP BY instrument_id
       ) t ON t.instrument_id = p.instrument_id AND t.d = p.bar_date
       WHERE p.close IS NOT NULL`,
    )
    .all() as { instrumentId: number; barDate: string; close: number | null }[];
  const annuals = db
    .prepare(
      `SELECT fp.instrument_id as instrumentId, fp.period_end as periodEnd, fp.available_at as availableAt,
              fp.line_items_json as lineItemsJson
       FROM financial_periods fp
       INNER JOIN (
         SELECT instrument_id, MAX(period_end) as d FROM financial_periods WHERE statement_type = 'annual' GROUP BY instrument_id
       ) t ON t.instrument_id = fp.instrument_id AND t.d = fp.period_end
       WHERE fp.statement_type = 'annual'`,
    )
    .all() as {
    instrumentId: number;
    periodEnd: string;
    availableAt: string | null;
    lineItemsJson: string | null;
  }[];
  const barById = new Map(lastBars.map((row) => [row.instrumentId, row]));
  const annualById = new Map(annuals.map((row) => [row.instrumentId, row]));
  return names.map((name) => {
    const bar = barById.get(name.id);
    const period = annualById.get(name.id);
    const items = parseLineItems(period?.lineItemsJson ?? null);
    return {
      ticker: name.ticker,
      name: name.name,
      listingStatus: name.listingStatus,
      instrumentType: name.instrumentType,
      researchProfile: (name.researchProfile ?? "GENERAL") as ResearchProfile,
      industry: name.industry,
      sector: name.sector,
      lastClose: bar?.close ?? null,
      lastCloseDate: bar?.barDate ?? null,
      periodEnd: period?.periodEnd ?? null,
      availableAt: period?.availableAt ?? null,
      eps: items.eps ?? null,
      dividendPerShare: items.dividendPerShare ?? null,
      equity: items.equity ?? null,
      shares: items.shares ?? null,
      revenue: items.revenue ?? null,
      pat: items.pat ?? null,
    };
  });
}

function parseLineItems(json: string | null): {
  eps?: number | null;
  dividendPerShare?: number | null;
  equity?: number | null;
  shares?: number | null;
  revenue?: number | null;
  pat?: number | null;
} {
  if (!json) return {};
  try {
    return JSON.parse(json) as ReturnType<typeof parseLineItems>;
  } catch {
    return {};
  }
}
