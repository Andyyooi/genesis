import { parse } from "csv-parse/sync";
import {
  classifyAnnouncement,
  parseClassification,
  type NewsClassification,
} from "@/ingest/classify";
import type { RejectedRow } from "@/ingest/types";

export type ParsedAnnouncementRow = {
  rowNumber: number;
  ticker: string;
  occurredAt: string;
  availableAt: string | null;
  source: string;
  sourceUrl: string | null;
  headline: string;
  excerpt: string | null;
  classification: NewsClassification;
  relevanceNote: string;
  classificationSource: "csv" | "rules";
};

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function parseDate(raw: string | undefined, label: string, rowNumber: number): string | null {
  if (blank(raw)) return null;
  const value = raw!.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    throw new Error(`row ${rowNumber}: ${label} must be YYYY-MM-DD`);
  }
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) {
    throw new Error(`row ${rowNumber}: ${label} is not a valid date`);
  }
  return value;
}

export function parseAnnouncementsCsv(csvText: string): {
  accepted: ParsedAnnouncementRow[];
  rejected: RejectedRow[];
} {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const accepted: ParsedAnnouncementRow[] = [];
  const rejected: RejectedRow[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const ticker = record.ticker?.trim() || null;
    try {
      if (!ticker) throw new Error(`row ${rowNumber}: ticker is required`);
      const occurredAt = parseDate(record.occurred_at, "occurred_at", rowNumber);
      if (!occurredAt) throw new Error(`row ${rowNumber}: occurred_at is required`);
      const headline = record.headline?.trim() ?? "";
      if (!headline) throw new Error(`row ${rowNumber}: headline is required`);
      const source = record.source?.trim() || "";
      if (!source) throw new Error(`row ${rowNumber}: source is required (do not invent a filing)`);

      const excerpt = blank(record.excerpt) ? null : record.excerpt.trim();
      const provided = parseClassification(record.classification);
      if (record.classification?.trim() && !provided) {
        throw new Error(
          `row ${rowNumber}: classification must be blank or one of Positive catalyst / Negative / Neutral / Uncertain`,
        );
      }
      const ruled = classifyAnnouncement(headline, excerpt);
      accepted.push({
        rowNumber,
        ticker: ticker.toUpperCase(),
        occurredAt,
        availableAt: parseDate(record.available_at, "available_at", rowNumber),
        source,
        sourceUrl: blank(record.source_url) ? null : record.source_url.trim(),
        headline,
        excerpt,
        classification: provided ?? ruled.classification,
        relevanceNote: provided
          ? `CSV provided classification ${provided}. Headlines are still not facts.`
          : ruled.relevanceNote,
        classificationSource: provided ? "csv" : "rules",
      });
    } catch (error) {
      rejected.push({
        rowNumber,
        ticker,
        reason: error instanceof Error ? error.message : "invalid row",
      });
    }
  });

  return { accepted, rejected };
}
