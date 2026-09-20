import { and, asc, count, desc, eq, max } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods, ingestReports, instruments, priceBars, scoreRuns } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";

export type WatchlistRow = {
  id: number;
  ticker: string;
  bursaCode: string | null;
  yahooTicker: string | null;
  name: string;
  sector: string | null;
  instrumentType: string;
  pn17: boolean;
  lastClose: number | null;
  lastTradeDate: string | null;
  barCount: number;
  periodCount: number;
};

export function loadWatchlist(): WatchlistRow[] {
  seedUniverseFromYaml();
  const db = getDb();
  const list = db.select().from(instruments).orderBy(asc(instruments.ticker)).all();

  const lastDates = db
    .select({
      instrumentId: priceBars.instrumentId,
      lastTradeDate: max(priceBars.barDate),
      barCount: count(),
    })
    .from(priceBars)
    .groupBy(priceBars.instrumentId)
    .all();

  const periodCounts = db
    .select({
      instrumentId: financialPeriods.instrumentId,
      periodCount: count(),
    })
    .from(financialPeriods)
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
      lastClose,
      lastTradeDate: last?.lastTradeDate ?? null,
      barCount: last?.barCount ?? 0,
      periodCount: periodsById.get(row.id) ?? 0,
    };
  });
}

export function loadInstrumentSnapshots(ticker: string) {
  seedUniverseFromYaml();
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

  return { instrument, periods, bars };
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
  return { fundamentals, prices };
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
