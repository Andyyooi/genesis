import { refreshAlertsForTicker } from "@/alerts/refresh";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, ingestReports, instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import {
  classifyEventType,
  defaultMateriality,
  sentimentFromLegacyClassification,
} from "@/events/classify";
import { buildDedupeKey } from "@/events/dedupe";
import { parseAnnouncementsCsv } from "@/ingest/providers/csv-announcements";
import type { EventsImportReport, RejectedRow } from "@/ingest/types";

export function importAnnouncementsCsv(filePath: string): EventsImportReport {
  const startedAt = new Date().toISOString();
  seedUniverseFromYaml();
  const db = getDb();
  const csvText = readFileSync(filePath, "utf8");
  const parsed = parseAnnouncementsCsv(csvText);
  const rejected: RejectedRow[] = [...parsed.rejected];
  let upserted = 0;
  const createdAt = new Date().toISOString();

  for (const row of parsed.accepted) {
    const instrument = db.select().from(instruments).where(eq(instruments.ticker, row.ticker)).get();
    if (!instrument) {
      rejected.push({
        rowNumber: row.rowNumber,
        ticker: row.ticker,
        reason: `ticker ${row.ticker} is not in the universe (COMMON_STOCK and REIT only)`,
      });
      continue;
    }

    const eventType = classifyEventType(row.headline, row.excerpt);
    const sentiment = sentimentFromLegacyClassification(row.classification);
    const dedupeKey = buildDedupeKey({
      source: row.source,
      sourceId: null,
      sourceUrl: row.sourceUrl,
      headline: row.headline,
      ticker: row.ticker,
      companyName: null,
      publishedAt: row.occurredAt,
      occurredAt: row.occurredAt,
    });

    db.insert(events)
      .values({
        instrumentId: instrument.id,
        occurredAt: row.occurredAt,
        publishedAt: row.occurredAt,
        availableAt: row.availableAt,
        retrievedAt: createdAt,
        source: row.source,
        sourceUrl: row.sourceUrl,
        sourceId: null,
        headline: row.headline,
        excerpt: row.excerpt,
        classification: row.classification,
        relevanceNote: row.relevanceNote,
        eventType,
        sentiment,
        materiality: defaultMateriality(eventType),
        eventConfidence: row.availableAt ? "MEDIUM" : "LOW",
        mappingConfidence: "HIGH",
        sourceReliability: "CURATED",
        companyNameRaw: null,
        bursaCodeRaw: null,
        dedupeKey,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoUpdate({
        target: [events.instrumentId, events.occurredAt, events.source, events.headline],
        set: {
          availableAt: row.availableAt,
          publishedAt: row.occurredAt,
          retrievedAt: createdAt,
          sourceUrl: row.sourceUrl,
          excerpt: row.excerpt,
          classification: row.classification,
          relevanceNote: row.relevanceNote,
          eventType,
          sentiment,
          materiality: defaultMateriality(eventType),
          eventConfidence: row.availableAt ? "MEDIUM" : "LOW",
          mappingConfidence: "HIGH",
          sourceReliability: "CURATED",
          dedupeKey,
          updatedAt: createdAt,
        },
      })
      .run();
    upserted += 1;
  }

  const report: EventsImportReport = {
    kind: "events",
    file: filePath,
    startedAt,
    finishedAt: new Date().toISOString(),
    accepted: upserted,
    upserted,
    rejected,
  };

  db.insert(ingestReports)
    .values({
      kind: "events",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify(report),
    })
    .run();

  for (const ticker of [...new Set(parsed.accepted.map((row) => row.ticker))]) {
    refreshAlertsForTicker(ticker);
  }

  return report;
}
