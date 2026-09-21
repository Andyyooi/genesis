import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods } from "@/db/schema";
import { mergeLineItems, parseLineItemsJson } from "@/ingest/merge-line-items";
import type { FundamentalPeriodDraft } from "@/providers/types";

export type PeriodPersistResult = "inserted" | "filled" | "unchanged" | "skipped_other_source";

/**
 * Keep every historical annual. Same-year Yahoo rows fill nulls only.
 * If CSV (or another non-Yahoo source) already owns that period-end, do not insert a duplicate year.
 */
export function persistAnnualPeriod(
  instrumentId: number,
  period: FundamentalPeriodDraft,
  retrievedAt: string,
): PeriodPersistResult {
  const incomingHasValue = Object.values(period.lineItems).some((value) => value !== null);
  if (!incomingHasValue) return "unchanged";

  const db = getDb();
  const sameYear = db
    .select()
    .from(financialPeriods)
    .where(
      and(
        eq(financialPeriods.instrumentId, instrumentId),
        eq(financialPeriods.periodEnd, period.periodEnd),
        eq(financialPeriods.statementType, period.statementType),
      ),
    )
    .all();

  const yahooRow = sameYear.find((row) => row.source.startsWith("yahoo"));
  if (yahooRow) {
    const merged = mergeLineItems(parseLineItemsJson(yahooRow.lineItemsJson), period.lineItems);
    const before = yahooRow.lineItemsJson ?? "";
    const after = JSON.stringify(merged);
    if (before === after) return "unchanged";
    db.update(financialPeriods)
      .set({
        lineItemsJson: after,
        retrievedAt,
        fiscalYear: yahooRow.fiscalYear ?? period.fiscalYear,
        availableAt: yahooRow.availableAt ?? period.availableAt,
      })
      .where(eq(financialPeriods.id, yahooRow.id))
      .run();
    return "filled";
  }

  if (sameYear.length > 0) return "skipped_other_source";

  db.insert(financialPeriods)
    .values({
      instrumentId,
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      periodEnd: period.periodEnd,
      availableAt: period.availableAt,
      retrievedAt,
      statementType: period.statementType,
      source: period.source,
      actualOrEstimate: period.actualOrEstimate,
      lineItemsJson: JSON.stringify(period.lineItems),
    })
    .run();
  return "inserted";
}
