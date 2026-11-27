import { inProgressSessionDate, usableYahooDailyBar } from "@/ingest/price-bar";
import type { YahooDividendCoverage } from "@/db/dividends";

export type YahooBar = {
  barDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjClose: number | null;
  split?: true;
};

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      events?: { splits?: Record<string, { date?: number }>; dividends?: Record<string, { date?: number; amount?: number }> };
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { description?: string; code?: string };
  };
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export { usableYahooDailyBar };

function utcDate(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function cashDividendCoverage(
  result: NonNullable<NonNullable<ChartResponse["chart"]>["result"]>[number],
  requestedSymbol: string,
  bars: YahooBar[],
): YahooDividendCoverage | undefined {
  const symbol = typeof result.meta?.symbol === "string" ? result.meta.symbol.toUpperCase() : null;
  const currency = result.meta?.currency;
  if (symbol !== requestedSymbol.toUpperCase() || !currency || !/^[A-Z]{3}$/.test(currency)) return;
  if (result.events !== undefined && (result.events === null || typeof result.events !== "object" || Array.isArray(result.events))) return;
  const from = bars[0].barDate;
  const through = bars[bars.length - 1].barDate;
  const raw = result.events?.dividends;
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) return;
  const events: YahooDividendCoverage["events"] = [];
  for (const [sourceId, row] of Object.entries(raw ?? {})) {
    if (typeof row?.date !== "number" || !Number.isFinite(new Date(row.date * 1000).getTime())) return;
    const exDate = utcDate(row.date);
    if (exDate < from || exDate > through) continue;
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount <= 0) return;
    events.push({ sourceId, exDate, amount: row.amount });
  }
  return { symbol, currency, from, through, events };
}

/** Waits before the 2nd and 3rd attempt when Yahoo times out, rate-limits or has a server error. */
export const YAHOO_RETRY_DELAYS_MS = [1000, 3000];

export type YahooFetchOptions = { retryDelaysMs?: number[]; now?: () => Date };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithRetries(url: URL, init: RequestInit, delays: number[]): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!retryableStatus(response.status) || attempt >= delays.length) return response;
    } catch (error) {
      if (attempt >= delays.length) throw error;
    }
    await sleep(delays[attempt]!);
  }
}

export async function fetchYahooDailyBars(
  yahooTicker: string,
  range: string | { startDate: string } = "5y",
  options: YahooFetchOptions = {},
): Promise<YahooBar[] & { dividendCoverage?: YahooDividendCoverage }> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`);
  url.searchParams.set("interval", "1d");
  if (typeof range === "string") {
    url.searchParams.set("range", range);
  } else {
    url.searchParams.set("period1", String(Date.parse(`${range.startDate}T00:00:00Z`) / 1000));
    url.searchParams.set("period2", String(Math.ceil(Date.now() / 1000)));
  }
  url.searchParams.set("events", "div,splits");

  const response = await fetchWithRetries(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  }, options.retryDelaysMs ?? YAHOO_RETRY_DELAYS_MS);

  if (!response.ok) {
    let detail = `Yahoo HTTP ${response.status} for ${yahooTicker}`;
    try {
      const errBody = (await response.json()) as ChartResponse;
      const description = errBody.chart?.error?.description;
      if (description) {
        detail = `Yahoo missed ${yahooTicker}: ${description}`;
      }
    } catch {
      /* keep HTTP status */
    }
    throw new Error(detail);
  }

  const body = (await response.json()) as ChartResponse;
  if (body.chart?.error) {
    throw new Error(
      `Yahoo missed ${yahooTicker}: ${body.chart.error.description ?? body.chart.error.code ?? "error"}`,
    );
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const adjSeries = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!timestamps?.length || !quote) {
    throw new Error(`Yahoo missed ${yahooTicker}: no daily bars returned`);
  }

  const bars: YahooBar[] = [];
  const splits = Object.values(result?.events?.splits ?? {})
    .flatMap(({ date }) => typeof date === "number" && Number.isFinite(date) ? [utcDate(date)] : [])
    .sort();
  let nextSplit = 0;
  const now = options.now?.() ?? new Date();
  const openSession = inProgressSessionDate(now);
  for (let i = 0; i < timestamps.length; i++) {
    const epoch = timestamps[i];
    const close = quote.close?.[i];
    if (typeof epoch !== "number" || !Number.isFinite(epoch) || typeof close !== "number") continue;
    const bar: YahooBar = {
      barDate: utcDate(epoch),
      open: quote.open?.[i] ?? null,
      high: quote.high?.[i] ?? null,
      low: quote.low?.[i] ?? null,
      close,
      volume: quote.volume?.[i] ?? null,
      adjClose: adjSeries?.[i] ?? null,
    };
    if (!usableYahooDailyBar(bar, now) || bar.barDate === openSession) continue;
    while (nextSplit < splits.length && splits[nextSplit] <= bar.barDate) {
      bar.split = true;
      nextSplit++;
    }
    bars.push(bar);
  }

  if (bars.length === 0) {
    throw new Error(`Yahoo missed ${yahooTicker}: bars had no closes`);
  }

  const dividendCoverage = result && cashDividendCoverage(result, yahooTicker, bars);
  return dividendCoverage ? Object.assign(bars, { dividendCoverage }) : bars;
}
