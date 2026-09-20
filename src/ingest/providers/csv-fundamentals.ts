import { parse } from "csv-parse/sync";
import type { LineItems, RejectedRow } from "@/ingest/types";

const STATEMENT_FIELDS = [
  "revenue",
  "pat",
  "equity",
  "total_debt",
  "cash",
  "ocf",
  "capex",
] as const;

const PER_SHARE_FIELDS = ["eps", "dividend_per_share"] as const;

export type ParsedFundamentalRow = {
  rowNumber: number;
  ticker: string;
  bursaCode: string | null;
  periodEnd: string;
  availableAt: string | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  statementType: string;
  actualOrEstimate: string;
  source: string;
  lineItems: LineItems;
};

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function parseOptionalInt(raw: string | undefined, label: string, rowNumber: number): number | null {
  if (blank(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`row ${rowNumber}: ${label} must be an integer`);
  }
  return n;
}

function parseNumber(raw: string | undefined, label: string, rowNumber: number): number | null {
  if (blank(raw)) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) {
    throw new Error(`row ${rowNumber}: ${label} is not a number (will not invent a value)`);
  }
  return n;
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
  return value.length === 10 ? value : value;
}

export function parseFundamentalsCsv(csvText: string): {
  accepted: ParsedFundamentalRow[];
  rejected: RejectedRow[];
} {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const accepted: ParsedFundamentalRow[] = [];
  const rejected: RejectedRow[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    try {
      const ticker = record.ticker?.trim() ?? "";
      const periodEnd = parseDate(record.period_end, "period_end", rowNumber);
      if (!ticker) {
        throw new Error(`row ${rowNumber}: ticker is required`);
      }
      if (!periodEnd) {
        throw new Error(`row ${rowNumber}: period_end is required`);
      }

      const unit = blank(record.unit) ? 1 : Number(record.unit);
      if (!Number.isFinite(unit) || unit <= 0) {
        throw new Error(`row ${rowNumber}: unit must be a positive number`);
      }

      const source = record.source?.trim() || "";
      if (!source) {
        throw new Error(`row ${rowNumber}: source is required (do not invent a filing)`);
      }

      const statementFields: Record<(typeof STATEMENT_FIELDS)[number], number | null> = {
        revenue: null,
        pat: null,
        equity: null,
        total_debt: null,
        cash: null,
        ocf: null,
        capex: null,
      };
      for (const field of STATEMENT_FIELDS) {
        const value = parseNumber(record[field], field, rowNumber);
        statementFields[field] = value === null ? null : value * unit;
      }

      const perShare: Record<(typeof PER_SHARE_FIELDS)[number], number | null> = {
        eps: null,
        dividend_per_share: null,
      };
      for (const field of PER_SHARE_FIELDS) {
        perShare[field] = parseNumber(record[field], field, rowNumber);
      }

      accepted.push({
        rowNumber,
        ticker: ticker.toUpperCase(),
        bursaCode: blank(record.bursa_code) ? null : record.bursa_code.trim(),
        periodEnd,
        availableAt: parseDate(record.available_at, "available_at", rowNumber),
        fiscalYear: parseOptionalInt(record.fiscal_year, "fiscal_year", rowNumber),
        fiscalQuarter: parseOptionalInt(record.fiscal_quarter, "fiscal_quarter", rowNumber),
        statementType: blank(record.statement_type) ? "annual" : record.statement_type.trim(),
        actualOrEstimate: blank(record.actual_or_estimate)
          ? "actual"
          : record.actual_or_estimate.trim(),
        source,
        lineItems: {
          revenue: statementFields.revenue,
          pat: statementFields.pat,
          eps: perShare.eps,
          equity: statementFields.equity,
          totalDebt: statementFields.total_debt,
          cash: statementFields.cash,
          ocf: statementFields.ocf,
          capex: statementFields.capex,
          shares: parseNumber(record.shares, "shares", rowNumber),
          dividendPerShare: perShare.dividend_per_share,
        },
      });
    } catch (error) {
      rejected.push({
        rowNumber,
        ticker: record.ticker?.trim() || null,
        reason: error instanceof Error ? error.message : "unknown parse error",
      });
    }
  });

  return { accepted, rejected };
}
