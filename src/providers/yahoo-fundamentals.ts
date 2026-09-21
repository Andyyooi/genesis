import { fiscalPeriodLabel } from "@/db/point-in-time";
import type { LineItems } from "@/ingest/types";
import { emptyLineItems } from "@/ingest/merge-line-items";
import {
  classifyHttpFailure,
  FundamentalIngestError,
} from "@/providers/fundamental-failures";
import { matchReportedDateForPeriod, parseYahooEarningsChart } from "@/providers/yahoo-earnings-dates";
import { createYahooSession, yahooFetch, type YahooSession } from "@/providers/yahoo-session";
import type { FundamentalPeriodDraft, FundamentalProvider } from "@/providers/types";

type YahooNumber = { raw?: number | null } | number | null | undefined;

function num(value: YahooNumber): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.raw === "number" && Number.isFinite(value.raw)) return value.raw;
  return null;
}

function isoDay(value: YahooNumber): string | null {
  const n = num(value);
  if (n === null) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

type StatementRow = Record<string, YahooNumber>;

type QuoteSummary = {
  quoteSummary?: {
    result?: Array<{
      assetProfile?: { sector?: string; industry?: string };
      defaultKeyStatistics?: { trailingEps?: YahooNumber; lastDividendValue?: YahooNumber };
      incomeStatementHistory?: { incomeStatementHistory?: StatementRow[] };
    }>;
    error?: { description?: string };
  };
};

type QuoteSummaryResult = NonNullable<NonNullable<QuoteSummary["quoteSummary"]>["result"]>[number] & {
  earnings?: { earningsChart?: { quarterly?: Array<{
    date?: string;
    fiscalQuarter?: string;
    periodEndDate?: { fmt?: string };
    reportedDate?: { fmt?: string };
  }> } };
};

type TimeseriesPoint = {
  asOfDate?: string;
  periodType?: string;
  reportedValue?: YahooNumber;
};

type TimeseriesResponse = {
  timeseries?: {
    result?: Array<Record<string, unknown>>;
    error?: { description?: string };
  };
};

const TIMESERIES_FIELDS: { key: string; line: keyof LineItems; abs?: boolean }[] = [
  { key: "annualTotalRevenue", line: "revenue" },
  { key: "annualNetIncome", line: "pat" },
  { key: "annualDilutedEPS", line: "eps" },
  { key: "annualStockholdersEquity", line: "equity" },
  { key: "annualTotalDebt", line: "totalDebt" },
  { key: "annualCashAndCashEquivalents", line: "cash" },
  { key: "annualOperatingCashFlow", line: "ocf" },
  { key: "annualCapitalExpenditure", line: "capex", abs: true },
  { key: "annualShareIssued", line: "shares" },
  { key: "annualTotalAssets", line: "totalAssets" },
];

export function parseYahooTimeseries(json: TimeseriesResponse, source: string): FundamentalPeriodDraft[] {
  const byEnd = new Map<string, FundamentalPeriodDraft>();
  const ensure = (periodEnd: string) => {
    let draft = byEnd.get(periodEnd);
    if (!draft) {
      const year = Number(periodEnd.slice(0, 4));
        draft = {
        periodEnd,
        fiscalYear: Number.isInteger(year) ? year : null,
        fiscalQuarter: null,
        fiscalPeriod: Number.isInteger(year) ? `FY${year}` : null,
        statementType: "annual",
        source,
        availableAt: null,
        filingDate: null,
        availableAtSource: null,
        actualOrEstimate: "actual",
        lineItems: emptyLineItems(),
      };
      byEnd.set(periodEnd, draft);
    }
    return draft;
  };

  for (const row of json.timeseries?.result ?? []) {
    for (const field of TIMESERIES_FIELDS) {
      const points = row[field.key];
      if (!Array.isArray(points)) continue;
      for (const point of points as TimeseriesPoint[]) {
        if (point.periodType && point.periodType !== "12M") continue;
        const periodEnd = point.asOfDate?.slice(0, 10);
        if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) continue;
        let value = num(point.reportedValue);
        if (value === null) continue;
        if (field.abs) value = Math.abs(value);
        ensure(periodEnd).lineItems[field.line] = value;
      }
    }
  }
  return [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

export function overlayYahooReportedDates(
  drafts: FundamentalPeriodDraft[],
  earningsResult: Parameters<typeof parseYahooEarningsChart>[0],
  ingestDay: string,
): FundamentalPeriodDraft[] {
  const dates = parseYahooEarningsChart(earningsResult);
  for (const draft of drafts) {
    const hit = matchReportedDateForPeriod({
      periodEnd: draft.periodEnd,
      dates,
      ingestDay,
    });
    if (!hit) continue;
    if (draft.availableAt) continue;
    draft.availableAt = hit.reportedDate;
    draft.filingDate = hit.reportedDate;
    draft.availableAtSource = "yahoo-earnings-reported-date";
    draft.fiscalPeriod =
      draft.fiscalPeriod ??
      fiscalPeriodLabel({
        fiscalYear: draft.fiscalYear,
        fiscalQuarter: draft.fiscalQuarter,
        periodEnd: draft.periodEnd,
        statementType: draft.statementType,
      });
  }
  return drafts;
}

export class YahooFundamentalProvider implements FundamentalProvider {
  readonly id = "yahoo-timeseries";
  private session: YahooSession | null = null;
  private summaryCache = new Map<string, QuoteSummaryResult | null>();

  private async sessionOrCreate() {
    this.session ??= await createYahooSession();
    return this.session;
  }

  private async summary(yahooTicker: string): Promise<QuoteSummaryResult | null> {
    const hit = this.summaryCache.get(yahooTicker);
    if (hit !== undefined) return hit;
    const session = await this.sessionOrCreate();
    const url = new URL(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}`,
    );
    url.searchParams.set("crumb", session.crumb);
    url.searchParams.set("modules", "incomeStatementHistory,assetProfile,defaultKeyStatistics,earnings");
    const response = await yahooFetch(url.toString(), session);
    if (!response.ok) {
      const code = classifyHttpFailure(response.status);
      throw new FundamentalIngestError(
        code,
        `Yahoo quoteSummary HTTP ${response.status} for ${yahooTicker}`,
        response.status,
      );
    }
    const body = (await response.json()) as QuoteSummary;
    if (body.quoteSummary?.error) {
      throw new FundamentalIngestError(
        "PROVIDER_ERROR",
        body.quoteSummary.error.description ?? "Yahoo quoteSummary error",
      );
    }
    const result = body.quoteSummary?.result?.[0] ?? null;
    this.summaryCache.set(yahooTicker, result);
    return result;
  }

  async profile(yahooTicker: string) {
    try {
      const row = await this.summary(yahooTicker);
      return {
        sector: row?.assetProfile?.sector ?? null,
        industry: row?.assetProfile?.industry ?? null,
      };
    } catch {
      return { sector: null, industry: null };
    }
  }

  async annualPeriods(yahooTicker: string): Promise<FundamentalPeriodDraft[]> {
    const fromSeries = await this.timeseriesAnnuals(yahooTicker);
    if (fromSeries.length) return fromSeries;
    return this.quoteSummaryAnnuals(yahooTicker);
  }

  private async timeseriesAnnuals(yahooTicker: string): Promise<FundamentalPeriodDraft[]> {
    const session = await this.sessionOrCreate();
    const url = new URL(
      `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooTicker)}`,
    );
    url.searchParams.set("lang", "en-US");
    url.searchParams.set("region", "MY");
    url.searchParams.set("merge", "false");
    url.searchParams.set("period1", "0");
    url.searchParams.set("period2", String(Math.floor(Date.now() / 1000)));
    url.searchParams.set("type", TIMESERIES_FIELDS.map((f) => f.key).join(","));
    const response = await yahooFetch(url.toString(), session);
    if (!response.ok) {
      const code = classifyHttpFailure(response.status);
      throw new FundamentalIngestError(
        code,
        `Yahoo timeseries HTTP ${response.status} for ${yahooTicker}`,
        response.status,
      );
    }
    let body: TimeseriesResponse;
    try {
      body = (await response.json()) as TimeseriesResponse;
    } catch {
      throw new FundamentalIngestError("PARSING_ERROR", `Yahoo timeseries JSON parse failed for ${yahooTicker}`);
    }
    if (body.timeseries?.error) {
      throw new FundamentalIngestError(
        "PROVIDER_ERROR",
        body.timeseries.error.description ?? "Yahoo timeseries error",
      );
    }
    const drafts = parseYahooTimeseries(body, this.id);
    try {
      const row = await this.summary(yahooTicker);
      if (row) overlayYahooReportedDates(drafts, row, new Date().toISOString().slice(0, 10));
    } catch {
      /* reportedDate is optional; never invent available_at */
    }
    return drafts;
  }

  private async quoteSummaryAnnuals(yahooTicker: string): Promise<FundamentalPeriodDraft[]> {
    const row = await this.summary(yahooTicker);
    if (!row) return [];
    const income = row.incomeStatementHistory?.incomeStatementHistory ?? [];
    const byEnd = new Map<string, FundamentalPeriodDraft>();
    const ensure = (periodEnd: string) => {
      let draft = byEnd.get(periodEnd);
      if (!draft) {
        const year = Number(periodEnd.slice(0, 4));
        draft = {
          periodEnd,
          fiscalYear: Number.isInteger(year) ? year : null,
          fiscalQuarter: null,
          fiscalPeriod: Number.isInteger(year) ? `FY${year}` : null,
          statementType: "annual",
          source: "yahoo-quote-summary",
          availableAt: null,
          filingDate: null,
          availableAtSource: null,
          actualOrEstimate: "actual",
          lineItems: emptyLineItems(),
        };
        byEnd.set(periodEnd, draft);
      }
      return draft;
    };
    for (const stmt of income) {
      const periodEnd = isoDay(stmt.endDate);
      if (!periodEnd) continue;
      const items = ensure(periodEnd).lineItems;
      items.revenue = num(stmt.totalRevenue);
      items.pat = num(stmt.netIncome);
    }
    return overlayYahooReportedDates(
      [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)),
      row,
      new Date().toISOString().slice(0, 10),
    );
  }
}
