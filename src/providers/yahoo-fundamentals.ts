import type { LineItems } from "@/ingest/types";
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
      balanceSheetHistory?: { balanceSheetStatements?: StatementRow[] };
      cashflowStatementHistory?: { cashflowStatements?: StatementRow[] };
    }>;
    error?: { description?: string };
  };
};

function emptyItems(): LineItems {
  return {
    revenue: null,
    pat: null,
    eps: null,
    equity: null,
    totalDebt: null,
    cash: null,
    ocf: null,
    capex: null,
    shares: null,
    dividendPerShare: null,
    navPerShare: null,
    totalAssets: null,
  };
}

type QuoteSummaryResult = NonNullable<NonNullable<QuoteSummary["quoteSummary"]>["result"]>[number];

export class YahooFundamentalProvider implements FundamentalProvider {
  readonly id = "yahoo-quote-summary";
  private session: YahooSession | null = null;
  private cache = new Map<string, QuoteSummaryResult | null>();

  private async sessionOrCreate() {
    this.session ??= await createYahooSession();
    return this.session;
  }

  private async summary(yahooTicker: string): Promise<QuoteSummaryResult | null> {
    const hit = this.cache.get(yahooTicker);
    if (hit !== undefined) return hit;
    const session = await this.sessionOrCreate();
    const url = new URL(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}`,
    );
    url.searchParams.set("crumb", session.crumb);
    url.searchParams.set(
      "modules",
      "incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,assetProfile,defaultKeyStatistics",
    );
    const response = await yahooFetch(url.toString(), session);
    if (!response.ok) {
      throw new Error(`Yahoo fundamentals HTTP ${response.status} for ${yahooTicker}`);
    }
    const body = (await response.json()) as QuoteSummary;
    if (body.quoteSummary?.error) {
      throw new Error(body.quoteSummary.error.description ?? "Yahoo quoteSummary error");
    }
    const result = body.quoteSummary?.result?.[0] ?? null;
    this.cache.set(yahooTicker, result);
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
    const row = await this.summary(yahooTicker);
    if (!row) return [];
    const income = row.incomeStatementHistory?.incomeStatementHistory ?? [];
    const balance = row.balanceSheetHistory?.balanceSheetStatements ?? [];
    const cashflow = row.cashflowStatementHistory?.cashflowStatements ?? [];
    const byEnd = new Map<string, FundamentalPeriodDraft>();

    const ensure = (periodEnd: string) => {
      let draft = byEnd.get(periodEnd);
      if (!draft) {
        const year = Number(periodEnd.slice(0, 4));
        draft = {
          periodEnd,
          fiscalYear: Number.isInteger(year) ? year : null,
          fiscalQuarter: null,
          statementType: "annual",
          source: this.id,
          availableAt: null,
          actualOrEstimate: "actual",
          lineItems: emptyItems(),
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
    for (const stmt of balance) {
      const periodEnd = isoDay(stmt.endDate);
      if (!periodEnd) continue;
      const items = ensure(periodEnd).lineItems;
      items.equity = num(stmt.totalStockholderEquity);
      items.totalDebt = num(stmt.shortLongTermDebt) ?? num(stmt.longTermDebt);
      items.cash = num(stmt.cash);
      items.totalAssets = num(stmt.totalAssets);
    }
    for (const stmt of cashflow) {
      const periodEnd = isoDay(stmt.endDate);
      if (!periodEnd) continue;
      const items = ensure(periodEnd).lineItems;
      items.ocf = num(stmt.totalCashFromOperatingActivities);
      items.capex = num(stmt.capitalExpenditures);
      if (items.capex !== null) items.capex = Math.abs(items.capex);
    }
    const eps = num(row.defaultKeyStatistics?.trailingEps);
    const dps = num(row.defaultKeyStatistics?.lastDividendValue);
    const latest = [...byEnd.keys()].sort().at(-1);
    if (latest) {
      if (eps !== null) byEnd.get(latest)!.lineItems.eps = eps;
      if (dps !== null) byEnd.get(latest)!.lineItems.dividendPerShare = dps;
    }
    return [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }
}
