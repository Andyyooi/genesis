import { refreshAlertsForTicker } from "@/alerts/refresh";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods, ingestReports, instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
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

    db.insert(financialPeriods)
      .values({
        instrumentId: instrument.id,
        fiscalYear: row.fiscalYear,
        fiscalQuarter: row.fiscalQuarter,
        periodEnd: row.periodEnd,
        availableAt: row.availableAt,
        retrievedAt,
        statementType: row.statementType,
        source: row.source,
        actualOrEstimate: row.actualOrEstimate,
        lineItemsJson: JSON.stringify(row.lineItems),
      })
      .onConflictDoUpdate({
        target: [
          financialPeriods.instrumentId,
          financialPeriods.periodEnd,
          financialPeriods.statementType,
          financialPeriods.source,
        ],
        set: {
          fiscalYear: row.fiscalYear,
          fiscalQuarter: row.fiscalQuarter,
          availableAt: row.availableAt,
          retrievedAt,
          actualOrEstimate: row.actualOrEstimate,
          lineItemsJson: JSON.stringify(row.lineItems),
        },
      })
      .run();
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
