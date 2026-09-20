import { loadUniverseConfig } from "@/config/load-universe";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";

export function seedUniverseFromYaml() {
  const universe = loadUniverseConfig();
  const db = getDb();
  const now = new Date().toISOString();

  for (const row of universe.instruments) {
    db.insert(instruments)
      .values({
        ticker: row.ticker,
        bursaCode: row.bursa_code ?? null,
        yahooTicker: row.yahoo_ticker ?? null,
        name: row.name,
        sector: row.sector ?? null,
        industry: row.industry ?? null,
        listingBoard: row.listing_board ?? null,
        instrumentType: row.instrument_type,
        pn17: row.pn17,
        currency: "MYR",
        shariahCompliant: row.shariah_compliant ?? null,
        watchlist: true,
        listingStatus: "listed",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: instruments.ticker,
        set: {
          bursaCode: row.bursa_code ?? null,
          yahooTicker: row.yahoo_ticker ?? null,
          name: row.name,
          sector: row.sector ?? null,
          industry: row.industry ?? null,
          listingBoard: row.listing_board ?? null,
          instrumentType: row.instrument_type,
          pn17: row.pn17,
          currency: "MYR",
          shariahCompliant: row.shariah_compliant ?? null,
          watchlist: true,
          listingStatus: "listed",
          updatedAt: now,
        },
      })
      .run();
  }

  return universe;
}
