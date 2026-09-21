import { eq } from "drizzle-orm";
import { refreshAlertsForTicker } from "@/alerts/refresh";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { CuratedFixtureEventProvider } from "@/events/fixture-provider";
import type { EventSourceProvider } from "@/events/types";
import { upsertMappedEvents, type EventsUpsertReport } from "@/events/upsert";
import { refuseSnapshotWrites } from "@/lib/data-mode";

/** Phase 16 controlled test set. */
export const PHASE16_EVENT_TICKERS = [
  "MAYBANK",
  "CIMB",
  "MRDIY",
  "INARI",
  "KLCC",
  "PAVREIT",
] as const;

/** Minimal instrument rows so INARI (not in universe.yaml) can be mapped in Phase 16 tests/ingest. */
const PHASE16_INSTRUMENT_SEEDS: Array<{
  ticker: string;
  bursaCode: string;
  yahooTicker: string;
  name: string;
  instrumentType: "COMMON_STOCK" | "REIT";
  researchProfile: string;
  sector: string;
  industry: string;
}> = [
  {
    ticker: "INARI",
    bursaCode: "0166",
    yahooTicker: "0166.KL",
    name: "Inari Amertron Berhad",
    instrumentType: "COMMON_STOCK",
    researchProfile: "GENERAL",
    sector: "Technology",
    industry: "Semiconductors",
  },
];

export function ensurePhase16Instruments(): void {
  seedUniverseFromYaml();
  const db = getDb();
  const now = new Date().toISOString();
  for (const row of PHASE16_INSTRUMENT_SEEDS) {
    const existing = db.select().from(instruments).where(eq(instruments.ticker, row.ticker)).get();
    if (existing) continue;
    db.insert(instruments)
      .values({
        ticker: row.ticker,
        bursaCode: row.bursaCode,
        yahooTicker: row.yahooTicker,
        name: row.name,
        sector: row.sector,
        industry: row.industry,
        listingBoard: "Main",
        instrumentType: row.instrumentType,
        researchProfile: row.researchProfile,
        pn17: false,
        currency: "MYR",
        shariahCompliant: null,
        watchlist: false,
        listingStatus: "listed",
        universeSource: "phase16-events-seed",
        universeSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export async function ingestPhase16Events(opts?: {
  tickers?: string[];
  provider?: EventSourceProvider;
  refreshAlerts?: boolean;
}): Promise<EventsUpsertReport> {
  refuseSnapshotWrites("events ingest");
  ensurePhase16Instruments();
  const tickers = opts?.tickers ?? [...PHASE16_EVENT_TICKERS];
  const provider = opts?.provider ?? new CuratedFixtureEventProvider();
  const drafts = await provider.list(tickers);
  const report = upsertMappedEvents(drafts, provider.id);
  if (opts?.refreshAlerts !== false) {
    for (const ticker of tickers) {
      try {
        refreshAlertsForTicker(ticker);
      } catch {
        // Alerts refresh is best-effort; event ingest must remain idempotent.
      }
    }
  }
  return report;
}
