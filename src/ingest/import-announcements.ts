import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, ingestReports, instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
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

    db.insert(events)
      .values({
        instrumentId: instrument.id,
        occurredAt: row.occurredAt,
        availableAt: row.availableAt,
        source: row.source,
        sourceUrl: row.sourceUrl,
        headline: row.headline,
        excerpt: row.excerpt,
        classification: row.classification,
        relevanceNote: row.relevanceNote,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [events.instrumentId, events.occurredAt, events.source, events.headline],
        set: {
          availableAt: row.availableAt,
          sourceUrl: row.sourceUrl,
          excerpt: row.excerpt,
          classification: row.classification,
          relevanceNote: row.relevanceNote,
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

  return report;
}
