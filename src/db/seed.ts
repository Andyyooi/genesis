import { eq } from "drizzle-orm";
import { loadUniverseConfig } from "@/config/load-universe";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import { assignResearchProfiles } from "@/research/assign-profiles";
import { clearPeerUniverseCache } from "@/scoring/valuation-context";

export function seedUniverseFromYaml() {
  const universe = loadUniverseConfig();
  if (isSnapshotReadOnly()) {
    return universe;
  }
  const db = getDb();
  const now = new Date().toISOString();

  for (const row of universe.instruments) {
    const existing = db.select().from(instruments).where(eq(instruments.ticker, row.ticker)).get();
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
        researchProfile: row.research_profile ?? null,
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
          sector: row.sector ?? existing?.sector ?? null,
          industry: row.industry ?? existing?.industry ?? null,
          listingBoard: row.listing_board ?? null,
          instrumentType: row.instrument_type,
          researchProfile: row.research_profile ?? existing?.researchProfile ?? null,
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

  assignResearchProfiles();
  clearPeerUniverseCache();
  return universe;
}
