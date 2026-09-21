import { eq, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ingestFailures, ingestReports, instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import type { InstrumentDraft, UniverseProvider } from "@/providers/types";
import { YahooMalaysiaUniverseProvider } from "@/providers/yahoo-universe";

export type UniverseRefreshReport = {
  kind: "universe";
  source: string;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  upserted: number;
  inactivated: number;
  excludedNote: string;
};

export async function refreshUniverse(provider: UniverseProvider = new YahooMalaysiaUniverseProvider()) {
  const startedAt = new Date().toISOString();
  seedUniverseFromYaml();
  const drafts = await provider.list();
  const db = getDb();
  const now = startedAt;
  let upserted = 0;

  for (const draft of drafts) {
    upsertInstrument(draft, now);
    upserted += 1;
  }

  const yahooTickers = drafts.map((d) => d.yahooTicker);
  const listed = db.select().from(instruments).all();
  let inactivated = 0;
  for (const row of listed) {
    if (row.watchlist) continue;
    if (row.yahooTicker && yahooTickers.includes(row.yahooTicker)) continue;
    if (row.listingStatus !== "inactive") {
      db.update(instruments)
        .set({ listingStatus: "inactive", updatedAt: now })
        .where(eq(instruments.id, row.id))
        .run();
      inactivated += 1;
    }
  }

  const report: UniverseRefreshReport = {
    kind: "universe",
    source: provider.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    fetched: drafts.length,
    upserted,
    inactivated,
    excludedNote: "Warrants and ETFs dropped by classifier. History rows were not deleted.",
  };
  db.insert(ingestReports)
    .values({
      kind: "universe",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify(report),
    })
    .run();
  return report;
}

function upsertInstrument(draft: InstrumentDraft, now: string) {
  const db = getDb();
  const clauses = [eq(instruments.yahooTicker, draft.yahooTicker), eq(instruments.ticker, draft.ticker)];
  if (draft.bursaCode) clauses.push(eq(instruments.bursaCode, draft.bursaCode));
  const existing = db.select().from(instruments).where(or(...clauses)).get() ?? null;

  if (existing) {
    db.update(instruments)
      .set({
        name: draft.name || existing.name,
        bursaCode: draft.bursaCode ?? existing.bursaCode,
        yahooTicker: draft.yahooTicker,
        instrumentType: existing.instrumentType === "REIT" || draft.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
        listingStatus: "listed",
        universeSource: draft.universeSource,
        universeSyncedAt: now,
        pn17: existing.pn17 || draft.pn17,
        sector: existing.sector ?? draft.sector,
        industry: existing.industry ?? draft.industry,
        updatedAt: now,
      })
      .where(eq(instruments.id, existing.id))
      .run();
    return;
  }

  db.insert(instruments)
    .values({
      ticker: uniqueTicker(draft.ticker),
      bursaCode: draft.bursaCode,
      yahooTicker: draft.yahooTicker,
      name: draft.name,
      sector: draft.sector,
      industry: draft.industry,
      listingBoard: draft.listingBoard,
      instrumentType: draft.instrumentType,
      pn17: draft.pn17,
      currency: "MYR",
      shariahCompliant: null,
      watchlist: false,
      listingStatus: "listed",
      universeSource: draft.universeSource,
      universeSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function uniqueTicker(base: string): string {
  const db = getDb();
  if (!db.select().from(instruments).where(eq(instruments.ticker, base)).get()) return base;
  let i = 2;
  while (db.select().from(instruments).where(eq(instruments.ticker, `${base}${i}`)).get()) i += 1;
  return `${base}${i}`;
}

export function recordIngestFailure(
  kind: string,
  ticker: string | null,
  yahooTicker: string | null,
  reason: string,
  failureCode?: string | null,
) {
  getDb()
    .insert(ingestFailures)
    .values({
      kind,
      ticker,
      yahooTicker,
      reason,
      failureCode: failureCode ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
}
