import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { fiscalPeriodLabel } from "@/db/point-in-time";
import { financialPeriods } from "@/db/schema";
import { mergeLineItems, parseLineItemsJson } from "@/ingest/merge-line-items";
import type { FundamentalPeriodDraft } from "@/providers/types";

export type PeriodPersistResult = "inserted" | "filled" | "unchanged" | "skipped_other_source";

export function availabilityPatch(
  existing: {
    availableAt: string | null;
    filingDate?: string | null;
    availableAtSource?: string | null;
    fiscalPeriod?: string | null;
    fiscalYear: number | null;
    fiscalQuarter: number | null;
    periodEnd: string;
    statementType: string;
  },
  incoming: {
    availableAt?: string | null;
    filingDate?: string | null;
    availableAtSource?: string | null;
    fiscalPeriod?: string | null;
    fiscalYear?: number | null;
    fiscalQuarter?: number | null;
  },
) {
  const availableAt = existing.availableAt ?? incoming.availableAt ?? null;
  const filingDate = existing.filingDate ?? incoming.filingDate ?? incoming.availableAt ?? null;
  const availableAtSource =
    existing.availableAtSource ??
    (existing.availableAt ? existing.availableAtSource : null) ??
    (availableAt && !existing.availableAt ? (incoming.availableAtSource ?? null) : null);
  const fiscalPeriod =
    existing.fiscalPeriod ??
    incoming.fiscalPeriod ??
    fiscalPeriodLabel({
      fiscalYear: existing.fiscalYear ?? incoming.fiscalYear ?? null,
      fiscalQuarter: existing.fiscalQuarter ?? incoming.fiscalQuarter ?? null,
      periodEnd: existing.periodEnd,
      statementType: existing.statementType,
    });
  return { availableAt, filingDate, availableAtSource, fiscalPeriod };
}

/**
 * Keep every historical annual. Same-year Yahoo rows fill nulls only.
 * If CSV (or another non-Yahoo source) already owns that period-end, do not insert a duplicate year.
 */
export function persistAnnualPeriod(
  instrumentId: number,
  period: FundamentalPeriodDraft,
  retrievedAt: string,
): PeriodPersistResult {
  const incomingHasValue =
    Object.values(period.lineItems).some((value) => value !== null) || Boolean(period.availableAt);
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
    const dates = availabilityPatch(yahooRow, period);
    const before = JSON.stringify({
      line: yahooRow.lineItemsJson ?? "",
      availableAt: yahooRow.availableAt,
      filingDate: yahooRow.filingDate,
      availableAtSource: yahooRow.availableAtSource,
      fiscalPeriod: yahooRow.fiscalPeriod,
    });
    const afterItems = JSON.stringify(merged);
    const after = JSON.stringify({
      line: afterItems,
      availableAt: dates.availableAt,
      filingDate: dates.filingDate,
      availableAtSource: dates.availableAtSource,
      fiscalPeriod: dates.fiscalPeriod,
    });
    if (before === after) return "unchanged";
    db.update(financialPeriods)
      .set({
        lineItemsJson: afterItems,
        retrievedAt,
        fiscalYear: yahooRow.fiscalYear ?? period.fiscalYear,
        fiscalQuarter: yahooRow.fiscalQuarter ?? period.fiscalQuarter,
        availableAt: dates.availableAt,
        filingDate: dates.filingDate,
        availableAtSource: dates.availableAtSource,
        fiscalPeriod: dates.fiscalPeriod,
      })
      .where(eq(financialPeriods.id, yahooRow.id))
      .run();
    return "filled";
  }

  if (sameYear.length > 0) return "skipped_other_source";

  const dates = availabilityPatch(
    {
      availableAt: null,
      filingDate: null,
      availableAtSource: null,
      fiscalPeriod: null,
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      periodEnd: period.periodEnd,
      statementType: period.statementType,
    },
    period,
  );
  db.insert(financialPeriods)
    .values({
      instrumentId,
      fiscalYear: period.fiscalYear,
      fiscalQuarter: period.fiscalQuarter,
      fiscalPeriod: dates.fiscalPeriod,
      periodEnd: period.periodEnd,
      availableAt: dates.availableAt,
      filingDate: dates.filingDate,
      availableAtSource: dates.availableAtSource,
      retrievedAt,
      statementType: period.statementType,
      source: period.source,
      actualOrEstimate: period.actualOrEstimate,
      lineItemsJson: JSON.stringify(period.lineItems),
    })
    .run();
  return "inserted";
}
