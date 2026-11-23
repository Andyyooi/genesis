import { and, asc, count, desc, eq, inArray, max, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companyCalendar, events, financialPeriods, ingestReports, instruments, marketScanRuns, priceBars, scoreRuns } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import type { EventSnapshot } from "@/metrics/types";
import { readPublishedWatchlist, type WatchlistReason } from "@/opportunities/watchlist-selection";

export type WatchlistRow = {
  id: number;
  ticker: string;
  bursaCode: string | null;
  yahooTicker: string | null;
  name: string;
  sector: string | null;
  instrumentType: string;
  pn17: boolean;
  reason: WatchlistReason | null;
  lastClose: number | null;
  lastTradeDate: string | null;
  barCount: number;
  periodCount: number;
};

export function loadWatchlistMembership() {
  const db = getDb();
  const publication = db.select({ summary: marketScanRuns.summaryJson })
    .from(marketScanRuns).orderBy(desc(marketScanRuns.id)).get();
  const selection = readPublishedWatchlist(publication?.summary);
  const reasons = new Map(selection.map(({ ticker, reason }) => [ticker, reason]));
  const list = db
    .select()
    .from(instruments)
    .where(and(
      ne(instruments.listingStatus, "inactive"),
      selection.length ? inArray(instruments.ticker, [...reasons.keys()]) : eq(instruments.watchlist, true),
    ))
    .orderBy(asc(instruments.ticker))
    .all();
  return list.map((row) => ({ ...row, reason: reasons.get(row.ticker) ?? null }));
}

export function loadWatchlist(): WatchlistRow[] {
  seedUniverseFromYaml();
  const db = getDb();
  const list = loadWatchlistMembership();
  if (!list.length) return [];
  const ids = list.map((row) => row.id);

  const lastDates = db
    .select({
      instrumentId: priceBars.instrumentId,
      lastTradeDate: max(priceBars.barDate),
      barCount: count(),
    })
    .from(priceBars)
    .where(inArray(priceBars.instrumentId, ids))
    .groupBy(priceBars.instrumentId)
    .all();

  const periodCounts = db
    .select({
      instrumentId: financialPeriods.instrumentId,
      periodCount: count(),
    })
    .from(financialPeriods)
    .where(inArray(financialPeriods.instrumentId, ids))
    .groupBy(financialPeriods.instrumentId)
    .all();

  const lastById = new Map(lastDates.map((row) => [row.instrumentId, row]));
  const periodsById = new Map(periodCounts.map((row) => [row.instrumentId, row.periodCount]));

  return list.map((row) => {
    const last = lastById.get(row.id);
    let lastClose: number | null = null;
    if (last?.lastTradeDate) {
      const bar = db
        .select()
        .from(priceBars)
        .where(
          and(
            eq(priceBars.instrumentId, row.id),
            eq(priceBars.barDate, last.lastTradeDate),
            eq(priceBars.source, "yahoo"),
          ),
        )
        .get();
      lastClose = bar?.close ?? null;
    }
    return {
      id: row.id,
      ticker: row.ticker,
      bursaCode: row.bursaCode,
      yahooTicker: row.yahooTicker,
      name: row.name,
      sector: row.sector,
      instrumentType: row.instrumentType,
      pn17: row.pn17,
      reason: row.reason,
      lastClose,
      lastTradeDate: last?.lastTradeDate ?? null,
      barCount: last?.barCount ?? 0,
      periodCount: periodsById.get(row.id) ?? 0,
    };
  });
}

export function loadDividendQuote(instrumentId: number) {
  return getDb().select({ annualYieldPercent: companyCalendar.annualYieldPercent, checkedAt: companyCalendar.checkedAt })
    .from(companyCalendar).where(eq(companyCalendar.instrumentId, instrumentId)).get();
}

export function loadInstrumentSnapshots(ticker: string, skipSeed = false) {
  if (!skipSeed) seedUniverseFromYaml();
  const db = getDb();
  const instrument = db
    .select()
    .from(instruments)
    .where(eq(instruments.ticker, ticker.toUpperCase()))
    .get();
  if (!instrument) return null;

  const periods = db
    .select()
    .from(financialPeriods)
    .where(eq(financialPeriods.instrumentId, instrument.id))
    .orderBy(desc(financialPeriods.periodEnd))
    .all();

  const bars = db
    .select()
    .from(priceBars)
    .where(eq(priceBars.instrumentId, instrument.id))
    .orderBy(desc(priceBars.barDate))
    .all();

  const eventRows = db
    .select()
    .from(events)
    .where(eq(events.instrumentId, instrument.id))
    .orderBy(desc(events.occurredAt))
    .all();

  const eventSnapshots: EventSnapshot[] = eventRows
    .filter((row) => (row.occurredAt || row.publishedAt) && row.headline && row.source)
    .map((row) => ({
      occurredAt: (row.occurredAt ?? row.publishedAt) as string,
      publishedAt: row.publishedAt ?? row.occurredAt,
      availableAt: row.availableAt,
      retrievedAt: row.retrievedAt,
      source: row.source as string,
      sourceUrl: row.sourceUrl,
      sourceId: row.sourceId,
      headline: row.headline as string,
      excerpt: row.excerpt,
      classification: row.classification ?? "Uncertain",
      relevanceNote: row.relevanceNote,
      eventType: row.eventType,
      sentiment: row.sentiment,
      materiality: row.materiality,
      eventConfidence: row.eventConfidence,
      mappingConfidence: row.mappingConfidence,
      sourceReliability: row.sourceReliability,
    }));

  return { instrument, periods, bars, events: eventSnapshots };
}

export function loadLatestIngestReports() {
  const db = getDb();
  const fundamentals = db
    .select()
    .from(ingestReports)
    .where(eq(ingestReports.kind, "fundamentals"))
    .orderBy(desc(ingestReports.id))
    .get();
  const prices = db
    .select()
    .from(ingestReports)
    .where(eq(ingestReports.kind, "prices"))
    .orderBy(desc(ingestReports.id))
    .get();
  const announcements = db
    .select()
    .from(ingestReports)
    .where(eq(ingestReports.kind, "events"))
    .orderBy(desc(ingestReports.id))
    .get();
  return { fundamentals, prices, announcements };
}

export function loadScoreHistory(instrumentId: number, limit = 8) {
  const db = getDb();
  return db
    .select({
      asOf: scoreRuns.asOf,
      createdAt: scoreRuns.createdAt,
      researchScore: scoreRuns.researchScore,
      valuationScore: scoreRuns.valuationScore,
      configHash: scoreRuns.configHash,
    })
    .from(scoreRuns)
    .where(eq(scoreRuns.instrumentId, instrumentId))
    .orderBy(desc(scoreRuns.id))
    .limit(limit)
    .all();
}
