import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, ingestReports } from "@/db/schema";
import { deriveEventConfidence, buildDedupeKey } from "@/events/dedupe";
import { mapDraftWithGuards } from "@/events/mapping";
import type { EventDraft, MappedEventDraft } from "@/events/types";

export type EventsUpsertReport = {
  kind: "events";
  source: string;
  startedAt: string;
  finishedAt: string;
  attempted: number;
  upserted: number;
  skippedDuplicate: number;
  unmapped: number;
  ambiguous: number;
  details: Array<{
    headline: string;
    ticker: string | null;
    mappingConfidence: string;
    eventConfidence: string;
    action: "upserted" | "duplicate" | "unmapped" | "ambiguous";
  }>;
};

export function prepareMappedDraft(draft: EventDraft, retrievedAt: string): MappedEventDraft {
  const db = getDb();
  const mapped = mapDraftWithGuards(db, draft);
  const publishedAt = draft.publishedAt ?? draft.occurredAt;
  const eventConfidence = deriveEventConfidence({
    mappingConfidence: mapped.mappingConfidence,
    publishedAt,
    sourceReliability: draft.sourceReliability,
  });
  return {
    ...draft,
    publishedAt,
    occurredAt: draft.occurredAt ?? publishedAt,
    instrumentId: mapped.instrumentId,
    mappingConfidence: mapped.mappingConfidence,
    mappingNote: mapped.mappingNote,
    eventConfidence,
    dedupeKey: buildDedupeKey(draft),
    retrievedAt,
  };
}

export function upsertMappedEvents(
  drafts: EventDraft[],
  sourceLabel: string,
): EventsUpsertReport {
  const startedAt = new Date().toISOString();
  const retrievedAt = startedAt;
  const db = getDb();
  const report: EventsUpsertReport = {
    kind: "events",
    source: sourceLabel,
    startedAt,
    finishedAt: startedAt,
    attempted: drafts.length,
    upserted: 0,
    skippedDuplicate: 0,
    unmapped: 0,
    ambiguous: 0,
    details: [],
  };

  for (const draft of drafts) {
    const mapped = prepareMappedDraft(draft, retrievedAt);
    if (mapped.mappingConfidence === "AMBIGUOUS") {
      report.ambiguous += 1;
      // Still store with null instrument_id for review.
    } else if (mapped.instrumentId === null) {
      report.unmapped += 1;
    }

    const existing = db
      .select()
      .from(events)
      .where(eq(events.dedupeKey, mapped.dedupeKey))
      .get();

    if (existing) {
      db.update(events)
        .set({
          instrumentId: mapped.instrumentId,
          occurredAt: mapped.occurredAt,
          publishedAt: mapped.publishedAt,
          availableAt: mapped.availableAt,
          retrievedAt: mapped.retrievedAt,
          source: mapped.source,
          sourceUrl: mapped.sourceUrl,
          sourceId: mapped.sourceId,
          headline: mapped.headline,
          excerpt: mapped.excerpt,
          classification: mapped.classification,
          relevanceNote: mapped.relevanceNote ?? mapped.mappingNote,
          eventType: mapped.eventType,
          sentiment: mapped.sentiment,
          materiality: mapped.materiality,
          eventConfidence: mapped.eventConfidence,
          mappingConfidence: mapped.mappingConfidence,
          sourceReliability: mapped.sourceReliability,
          companyNameRaw: mapped.companyName,
          bursaCodeRaw: mapped.bursaCode,
          updatedAt: mapped.retrievedAt,
        })
        .where(eq(events.id, existing.id))
        .run();
      report.skippedDuplicate += 1;
      report.details.push({
        headline: mapped.headline,
        ticker: mapped.ticker,
        mappingConfidence: mapped.mappingConfidence,
        eventConfidence: mapped.eventConfidence,
        action: "duplicate",
      });
      continue;
    }

    // Legacy unique index path for Phase 8 rows without dedupe_key yet.
    if (mapped.instrumentId !== null && mapped.occurredAt) {
      const legacy = db
        .select()
        .from(events)
        .where(
          and(
            eq(events.instrumentId, mapped.instrumentId),
            eq(events.occurredAt, mapped.occurredAt),
            eq(events.source, mapped.source),
            eq(events.headline, mapped.headline),
          ),
        )
        .get();
      if (legacy) {
        db.update(events)
          .set({
            dedupeKey: mapped.dedupeKey,
            publishedAt: mapped.publishedAt,
            availableAt: mapped.availableAt,
            retrievedAt: mapped.retrievedAt,
            sourceUrl: mapped.sourceUrl,
            sourceId: mapped.sourceId,
            excerpt: mapped.excerpt,
            classification: mapped.classification,
            relevanceNote: mapped.relevanceNote ?? mapped.mappingNote,
            eventType: mapped.eventType,
            sentiment: mapped.sentiment,
            materiality: mapped.materiality,
            eventConfidence: mapped.eventConfidence,
            mappingConfidence: mapped.mappingConfidence,
            sourceReliability: mapped.sourceReliability,
            companyNameRaw: mapped.companyName,
            bursaCodeRaw: mapped.bursaCode,
            updatedAt: mapped.retrievedAt,
          })
          .where(eq(events.id, legacy.id))
          .run();
        report.skippedDuplicate += 1;
        report.details.push({
          headline: mapped.headline,
          ticker: mapped.ticker,
          mappingConfidence: mapped.mappingConfidence,
          eventConfidence: mapped.eventConfidence,
          action: "duplicate",
        });
        continue;
      }
    }

    db.insert(events)
      .values({
        instrumentId: mapped.instrumentId,
        occurredAt: mapped.occurredAt,
        publishedAt: mapped.publishedAt,
        availableAt: mapped.availableAt,
        retrievedAt: mapped.retrievedAt,
        source: mapped.source,
        sourceUrl: mapped.sourceUrl,
        sourceId: mapped.sourceId,
        headline: mapped.headline,
        excerpt: mapped.excerpt,
        classification: mapped.classification,
        relevanceNote: mapped.relevanceNote ?? mapped.mappingNote,
        eventType: mapped.eventType,
        sentiment: mapped.sentiment,
        materiality: mapped.materiality,
        eventConfidence: mapped.eventConfidence,
        mappingConfidence: mapped.mappingConfidence,
        sourceReliability: mapped.sourceReliability,
        companyNameRaw: mapped.companyName,
        bursaCodeRaw: mapped.bursaCode,
        dedupeKey: mapped.dedupeKey,
        createdAt: mapped.retrievedAt,
        updatedAt: mapped.retrievedAt,
      })
      .run();
    report.upserted += 1;
    report.details.push({
      headline: mapped.headline,
      ticker: mapped.ticker,
      mappingConfidence: mapped.mappingConfidence,
      eventConfidence: mapped.eventConfidence,
      action:
        mapped.mappingConfidence === "AMBIGUOUS"
          ? "ambiguous"
          : mapped.instrumentId === null
            ? "unmapped"
            : "upserted",
    });
  }

  report.finishedAt = new Date().toISOString();
  db.insert(ingestReports)
    .values({
      kind: "events",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify(report),
    })
    .run();

  return report;
}

/** Backfill dedupe keys for legacy rows that still have null dedupe_key. */
export function backfillLegacyDedupeKeys(): number {
  const db = getDb();
  const rows = db.select().from(events).where(isNull(events.dedupeKey)).all();
  let n = 0;
  for (const row of rows) {
    if (!row.headline || !row.source) continue;
    const key = buildDedupeKey({
      source: row.source,
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      headline: row.headline,
      ticker: null,
      companyName: row.companyNameRaw,
      publishedAt: row.publishedAt,
      occurredAt: row.occurredAt,
    });
    db.update(events).set({ dedupeKey: key }).where(eq(events.id, row.id)).run();
    n += 1;
  }
  return n;
}
