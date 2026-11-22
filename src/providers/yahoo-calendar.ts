import { createYahooSession, yahooFetch, type YahooSession } from "@/providers/yahoo-session";

export type YahooCalendarQuote = {
  symbol: string;
  earningsTimestamp?: number;
  earningsTimestampStart?: number;
  earningsTimestampEnd?: number;
  isEarningsDateEstimate?: boolean;
  exDividendDate?: number;
  dividendDate?: number;
  dividendYield?: number;
};

const quoteFields = [
  "earningsTimestamp", "earningsTimestampStart", "earningsTimestampEnd", "isEarningsDateEstimate",
  "exDividendDate", "dividendDate", "dividendYield",
];

export function yahooCalendarDate(timestamp: unknown): string | null {
  if (typeof timestamp !== "number") return null;
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1990 && date.getUTCFullYear() <= 2100
    ? date.toISOString().slice(0, 10)
    : null;
}

export function parseYahooCalendarQuote(quote: YahooCalendarQuote) {
  const point = yahooCalendarDate(quote.earningsTimestamp);
  const start = yahooCalendarDate(quote.earningsTimestampStart);
  const end = yahooCalendarDate(quote.earningsTimestampEnd);
  const isRange = !!(start && end && end > start);
  const resultsFrom = isRange ? start : point ?? start ?? end;
  const exDate = yahooCalendarDate(quote.exDividendDate);
  const payment = yahooCalendarDate(quote.dividendDate);
  return {
    resultsFrom,
    resultsThrough: isRange ? end : resultsFrom,
    resultsEstimated: isRange || quote.isEarningsDateEstimate !== false,
    exDate,
    paymentDate: payment && (!exDate || payment >= exDate) ? payment : null,
    annualYieldPercent: typeof quote.dividendYield === "number" && Number.isFinite(quote.dividendYield) && quote.dividendYield >= 0
      ? quote.dividendYield
      : null,
  };
}

export function parseYahooDividend(body: unknown, exDate: string) {
  const result = (body as { chart?: { result?: {
    meta?: { currency?: string };
    events?: { dividends?: Record<string, { date?: number; amount?: number }> };
  }[] } } | null)?.chart?.result?.[0];
  const currency = result?.meta?.currency;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const matches = Object.values(result.events?.dividends ?? {}).filter((event) => yahooCalendarDate(event.date) === exDate);
  const amount = matches[0]?.amount;
  return matches.length === 1 && typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? { amount, currency }
    : null;
}

export type CalendarSource = {
  quotes: (symbols: string[]) => Promise<YahooCalendarQuote[]>;
  dividend: (symbol: string, exDate: string) => Promise<{ amount: number; currency: string } | null>;
};

export function yahooCalendarSource(): CalendarSource {
  let session: Promise<YahooSession> | undefined;
  async function request(path: string, params: Record<string, string>) {
    session ??= createYahooSession();
    const auth = await session;
    const url = new URL(path, "https://query1.finance.yahoo.com");
    url.search = new URLSearchParams({ ...params, crumb: auth.crumb }).toString();
    const response = await yahooFetch(url.toString(), auth, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Yahoo calendar returned HTTP ${response.status}`);
    return response.json();
  }
  return {
    async quotes(symbols) {
      const body = await request("/v7/finance/quote", {
        symbols: symbols.join(","),
        fields: quoteFields.join(","),
      });
      if (!Array.isArray(body.quoteResponse?.result) || body.quoteResponse.error) {
        throw new Error("Yahoo calendar response was unavailable");
      }
      return body.quoteResponse.result;
    },
    async dividend(symbol, exDate) {
      const seconds = Date.parse(exDate) / 1000;
      const body = await request(`/v8/finance/chart/${encodeURIComponent(symbol)}`, {
        period1: String(seconds - 86400),
        period2: String(seconds + 86400 * 2),
        interval: "1d",
        events: "div",
      });
      return parseYahooDividend(body, exDate);
    },
  };
}
