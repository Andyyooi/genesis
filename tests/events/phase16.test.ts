import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { events, instruments } from "@/db/schema";
import {
  classifyEventSentiment,
  classifyEventType,
  defaultMateriality,
} from "@/events/classify";
import { buildDedupeKey, deriveEventConfidence } from "@/events/dedupe";
import { CuratedFixtureEventProvider } from "@/events/fixture-provider";
import { ensurePhase16Instruments, ingestPhase16Events, PHASE16_EVENT_TICKERS } from "@/events/ingest";
import { mapDraftWithGuards, mapEventToInstrument } from "@/events/mapping";
import { filterEventsAsOf, isPitSafeEvent } from "@/events/pit";
import type { EventDraft } from "@/events/types";
import { upsertMappedEvents } from "@/events/upsert";
import { scoreTicker } from "@/scoring/run-ticker";

function resetDbSingleton() {
  const g = globalThis as unknown as { sqlite?: { close: () => void } };
  if (g.sqlite) {
    g.sqlite.close();
    g.sqlite = undefined;
  }
}

describe("Phase 16 event taxonomy", () => {
  it("classifies results and dividends without BUY/SELL language", () => {
    expect(classifyEventType("Maybank 9M FY24 net profit rises 8.5%", null)).toBe("RESULTS");
    expect(classifyEventType("Interim dividend of 10 sen", null)).toBe("DIVIDEND");
    expect(classifyEventType("Random operational note", null)).toBe("UNKNOWN");
    const tone = classifyEventSentiment("Net profit rises", null);
    expect(tone.sentiment).toBe("POSITIVE");
    expect(tone.relevanceNote).not.toMatch(/\bBUY\b|\bSELL\b/);
    expect(defaultMateriality("RESULTS")).toBe("MEDIUM");
    expect(defaultMateriality("PN17")).toBe("HIGH");
    expect(defaultMateriality("UNKNOWN")).toBe("UNKNOWN");
  });
});

describe("Phase 16 dedupe + confidence", () => {
  it("prefers sourceId, then URL, then headline fingerprint", () => {
    expect(
      buildDedupeKey({
        source: "CIMB Newsroom",
        sourceId: "abc",
        sourceUrl: "https://example.com/a",
        headline: "H",
        ticker: "CIMB",
        companyName: null,
        publishedAt: "2025-05-30",
        occurredAt: "2025-05-30",
      }),
    ).toBe("sid:cimb newsroom|abc");
    expect(
      buildDedupeKey({
        source: "CIMB Newsroom",
        sourceId: null,
        sourceUrl: "https://Example.com/a#frag",
        headline: "H",
        ticker: "CIMB",
        companyName: null,
        publishedAt: "2025-05-30",
        occurredAt: "2025-05-30",
      }),
    ).toMatch(/^url:https:\/\/example.com\/a/);
  });

  it("derives confidence from mapping + published_at + source reliability", () => {
    expect(
      deriveEventConfidence({
        mappingConfidence: "HIGH",
        publishedAt: "2025-05-30",
        sourceReliability: "CURATED",
      }),
    ).toBe("HIGH");
    expect(
      deriveEventConfidence({
        mappingConfidence: "HIGH",
        publishedAt: null,
        sourceReliability: "CURATED",
      }),
    ).toBe("LOW");
    expect(
      deriveEventConfidence({
        mappingConfidence: "AMBIGUOUS",
        publishedAt: "2025-05-30",
        sourceReliability: "PRIMARY",
      }),
    ).toBe("UNKNOWN");
  });
});

describe("Phase 16 PIT filtering", () => {
  const rows = [
    {
      occurredAt: "2025-05-30",
      publishedAt: "2025-05-30",
      availableAt: "2025-05-30",
      source: "CIMB Newsroom",
      sourceUrl: null,
      headline: "Results",
      excerpt: null,
      classification: "Positive catalyst",
      relevanceNote: null,
      eventType: "RESULTS",
      sentiment: "POSITIVE",
      materiality: "MEDIUM",
      eventConfidence: "HIGH",
      mappingConfidence: "HIGH",
      sourceReliability: "CURATED",
      retrievedAt: "2026-09-22T00:00:00.000Z",
      sourceId: null,
    },
    {
      occurredAt: "2025-08-01",
      publishedAt: null,
      availableAt: null,
      source: "unknown",
      sourceUrl: null,
      headline: "Undated note",
      excerpt: null,
      classification: "Uncertain",
      relevanceNote: null,
      eventType: "UNKNOWN",
      sentiment: "UNKNOWN",
      materiality: "UNKNOWN",
      eventConfidence: "LOW",
      mappingConfidence: "HIGH",
      sourceReliability: "UNKNOWN",
      retrievedAt: "2026-09-22T00:00:00.000Z",
      sourceId: null,
    },
  ];

  it("requires available_at for PIT-safe queries and never treats retrieved_at as publication", () => {
    expect(isPitSafeEvent(rows[0])).toBe(true);
    expect(isPitSafeEvent(rows[1])).toBe(false);
    const pit = filterEventsAsOf(rows, "2025-06-15", { requirePitSafe: true });
    expect(pit).toHaveLength(1);
    expect(pit[0]?.headline).toBe("Results");
    const legacy = filterEventsAsOf(rows, "2025-09-01", { requirePitSafe: false });
    expect(legacy).toHaveLength(2);
  });
});

describe("Phase 16 mapping + upsert + fixture ingest", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bursa-events-"));
    mkdirSync(dir, { recursive: true });
    process.env.BURSA_SQLITE_PATH = join(dir, "test.db");
    resetDbSingleton();
  });

  afterEach(() => {
    resetDbSingleton();
    delete process.env.BURSA_SQLITE_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  function seedTicker(ticker: string, name: string, bursaCode: string) {
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(instruments)
      .values({
        ticker,
        bursaCode,
        yahooTicker: `${bursaCode}.KL`,
        name,
        sector: "Test",
        industry: "Test",
        listingBoard: "Main",
        instrumentType:
          ticker === "KLCC" || ticker === "PAVREIT" ? "REIT" : "COMMON_STOCK",
        researchProfile:
          ticker === "MAYBANK" || ticker === "CIMB"
            ? "BANK"
            : ticker === "KLCC" || ticker === "PAVREIT"
              ? "REIT"
              : "GENERAL",
        pn17: false,
        currency: "MYR",
        watchlist: true,
        listingStatus: "listed",
        universeSource: "test",
        universeSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  it("maps by ticker/Bursa code and refuses weak name guesses", () => {
    seedTicker("MAYBANK", "Malayan Banking Berhad", "1155");
    seedTicker("CIMB", "CIMB Group Holdings Berhad", "1023");
    const db = getDb();
    expect(
      mapEventToInstrument(db, {
        ticker: "MAYBANK",
        bursaCode: null,
        companyName: null,
        eventType: "RESULTS",
        headline: "x",
        excerpt: null,
        source: "t",
        sourceUrl: null,
        sourceId: null,
        publishedAt: "2024-01-01",
        occurredAt: "2024-01-01",
        availableAt: "2024-01-01",
        sentiment: "NEUTRAL",
        materiality: "UNKNOWN",
        sourceReliability: "CURATED",
        classification: "Neutral",
        relevanceNote: null,
      }).mappingConfidence,
    ).toBe("HIGH");

    expect(
      mapEventToInstrument(db, {
        ticker: null,
        bursaCode: "1023",
        companyName: null,
        eventType: "RESULTS",
        headline: "x",
        excerpt: null,
        source: "t",
        sourceUrl: null,
        sourceId: null,
        publishedAt: "2024-01-01",
        occurredAt: "2024-01-01",
        availableAt: "2024-01-01",
        sentiment: "NEUTRAL",
        materiality: "UNKNOWN",
        sourceReliability: "CURATED",
        classification: "Neutral",
        relevanceNote: null,
      }).instrumentId,
    ).not.toBeNull();

    expect(
      mapEventToInstrument(db, {
        ticker: null,
        bursaCode: null,
        companyName: "Bank something vague",
        eventType: "OTHER",
        headline: "x",
        excerpt: null,
        source: "t",
        sourceUrl: null,
        sourceId: null,
        publishedAt: null,
        occurredAt: null,
        availableAt: null,
        sentiment: "UNKNOWN",
        materiality: "UNKNOWN",
        sourceReliability: "UNKNOWN",
        classification: "Uncertain",
        relevanceNote: null,
      }).mappingConfidence,
    ).toBe("UNMAPPED");
  });

  it("leaves multi-ticker headlines unmapped when ticker is not pinned", () => {
    seedTicker("MAYBANK", "Malayan Banking Berhad", "1155");
    seedTicker("CIMB", "CIMB Group Holdings Berhad", "1023");
    const db = getDb();
    const hit = mapDraftWithGuards(db, {
      ticker: null,
      bursaCode: null,
      companyName: null,
      eventType: "OTHER",
      headline: "MAYBANK and CIMB both mentioned in a broker note",
      excerpt: null,
      source: "t",
      sourceUrl: null,
      sourceId: "multi-1",
      publishedAt: "2024-01-01",
      occurredAt: "2024-01-01",
      availableAt: "2024-01-01",
      sentiment: "UNCERTAIN",
      materiality: "UNKNOWN",
      sourceReliability: "SECONDARY",
      classification: "Uncertain",
      relevanceNote: null,
    });
    expect(hit.mappingConfidence).toBe("AMBIGUOUS");
    expect(hit.instrumentId).toBeNull();
  });

  it("upserts fixture events idempotently for the Phase 16 tickers", async () => {
    // universe.yaml seeds the watchlist names; Phase 16 adds INARI if missing.
    ensurePhase16Instruments();

    const first = await ingestPhase16Events({ refreshAlerts: false });
    expect(first.upserted).toBeGreaterThanOrEqual(6);
    const second = await ingestPhase16Events({ refreshAlerts: false });
    expect(second.upserted).toBe(0);
    expect(second.skippedDuplicate).toBeGreaterThanOrEqual(6);

    const db = getDb();
    for (const ticker of PHASE16_EVENT_TICKERS) {
      const inst = db.select().from(instruments).where(eq(instruments.ticker, ticker)).get();
      expect(inst, ticker).toBeTruthy();
      const rows = db.select().from(events).where(eq(events.instrumentId, inst!.id)).all();
      expect(rows.length, ticker).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => Boolean(r.retrievedAt && r.publishedAt))).toBe(true);
      expect(rows.every((r) => Boolean(r.eventConfidence))).toBe(true);
      expect(rows.every((r) => r.availableAt !== r.retrievedAt)).toBe(true);
    }

    const scored = scoreTicker("MAYBANK", false, { attachValuationContext: false });
    expect(scored?.events.length).toBeGreaterThan(0);
    expect(scored?.result.categories.find((c) => c.id === "news")?.inThisRun).toBe(false);
  });

  it("stores unmapped rows with null instrument_id for review", () => {
    const draft: EventDraft = {
      ticker: "NOTREAL",
      bursaCode: null,
      companyName: null,
      eventType: "OTHER",
      headline: "Orphan announcement",
      excerpt: null,
      source: "test",
      sourceUrl: "https://example.com/orphan",
      sourceId: "orphan-1",
      publishedAt: "2024-06-01",
      occurredAt: "2024-06-01",
      availableAt: "2024-06-01",
      sentiment: "UNKNOWN",
      materiality: "UNKNOWN",
      sourceReliability: "UNKNOWN",
      classification: "Uncertain",
      relevanceNote: null,
    };
    const report = upsertMappedEvents([draft], "test");
    expect(report.unmapped).toBe(1);
    const row = getDb().select().from(events).where(eq(events.sourceId, "orphan-1")).get();
    expect(row?.instrumentId).toBeNull();
    expect(row?.mappingConfidence).toBe("UNMAPPED");
  });

  it("loads curated fixture drafts for all required tickers", async () => {
    const provider = new CuratedFixtureEventProvider();
    const drafts = await provider.list([...PHASE16_EVENT_TICKERS]);
    const tickers = new Set(drafts.map((d) => d.ticker));
    for (const t of PHASE16_EVENT_TICKERS) expect(tickers.has(t)).toBe(true);
    expect(drafts.every((d) => d.publishedAt)).toBe(true);
  });
});
