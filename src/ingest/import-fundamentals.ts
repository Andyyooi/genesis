import { refreshAlertsForTicker } from "@/alerts/refresh";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods, ingestReports, instruments } from "@/db/schema";
import { availabilityPatch } from "@/ingest/persist-annual-period";
import { seedUniverseFromYaml } from "@/db/seed";
import { mergeLineItems, parseLineItemsJson } from "@/ingest/merge-line-items";
import { parseFundamentalsCsv } from "@/ingest/providers/csv-fundamentals";
import type { FundamentalsImportReport, RejectedRow } from "@/ingest/types";

export function importFundamentalsCsv(filePath: string): FundamentalsImportReport {
  const startedAt = new Date().toISOString();
  seedUniverseFromYaml();
  const db = getDb();
  const csvText = readFileSync(filePath, "utf8");
  const parsed = parseFundamentalsCsv(csvText);
  const rejected: RejectedRow[] = [...parsed.rejected];
  let upserted = 0;
  const retrievedAt = new Date().toISOString();

  for (const row of parsed.accepted) {
    const instrument =
      db.select().from(instruments).where(eq(instruments.ticker, row.ticker)).get() ??
      (row.bursaCode
        ? db.select().from(instruments).where(eq(instruments.bursaCode, row.bursaCode)).get()
        : undefined);

    if (!instrument) {
      rejected.push({
        rowNumber: row.rowNumber,
        ticker: row.ticker,
        reason: `ticker ${row.ticker} is not in the universe (COMMON_STOCK and REIT only)`,
      });
      continue;
    }

    const existing = db
      .select()
      .from(financialPeriods)
      .where(
        and(
          eq(financialPeriods.instrumentId, instrument.id),
          eq(financialPeriods.periodEnd, row.periodEnd),
          eq(financialPeriods.statementType, row.statementType),
          eq(financialPeriods.source, row.source),
        ),
      )
      .get();

    const incomingDates = {
      availableAt: row.availableAt ?? row.filingDate,
      filingDate: row.filingDate ?? row.availableAt,
      availableAtSource: row.availableAt || row.filingDate ? "csv" : null,
      fiscalYear: row.fiscalYear,
      fiscalQuarter: row.fiscalQuarter,
    };

    if (existing) {
      const merged = mergeLineItems(parseLineItemsJson(existing.lineItemsJson), row.lineItems);
      const dates = availabilityPatch(existing, incomingDates);
      db.update(financialPeriods)
        .set({
          fiscalYear: existing.fiscalYear ?? row.fiscalYear,
          fiscalQuarter: existing.fiscalQuarter ?? row.fiscalQuarter,
          fiscalPeriod: dates.fiscalPeriod,
          availableAt: dates.availableAt,
          filingDate: dates.filingDate,
          availableAtSource: dates.availableAtSource,
          retrievedAt,
          actualOrEstimate: row.actualOrEstimate,
          lineItemsJson: JSON.stringify(merged),
        })
        .where(eq(financialPeriods.id, existing.id))
        .run();
    } else {
      const dates = availabilityPatch(
        {
          availableAt: null,
          filingDate: null,
          availableAtSource: null,
          fiscalPeriod: null,
          fiscalYear: row.fiscalYear,
          fiscalQuarter: row.fiscalQuarter,
          periodEnd: row.periodEnd,
          statementType: row.statementType,
        },
        incomingDates,
      );
      db.insert(financialPeriods)
        .values({
          instrumentId: instrument.id,
          fiscalYear: row.fiscalYear,
          fiscalQuarter: row.fiscalQuarter,
          fiscalPeriod: dates.fiscalPeriod,
          periodEnd: row.periodEnd,
          availableAt: dates.availableAt,
          filingDate: dates.filingDate,
          availableAtSource: dates.availableAtSource,
          retrievedAt,
          statementType: row.statementType,
          source: row.source,
          actualOrEstimate: row.actualOrEstimate,
          lineItemsJson: JSON.stringify(row.lineItems),
        })
        .run();
    }
    upserted += 1;
  }

  const report: FundamentalsImportReport = {
    kind: "fundamentals",
    file: filePath,
    startedAt,
    finishedAt: new Date().toISOString(),
    accepted: upserted,
    upserted,
    rejected,
  };

  db.insert(ingestReports)
    .values({
      kind: "fundamentals",
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
