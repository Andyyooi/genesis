export type YahooBar = {
  barDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type ChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string; code?: string };
  };
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function utcDate(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export async function fetchYahooDailyBars(yahooTicker: string): Promise<YahooBar[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "5y");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; bursa-research-local/0.1)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status} for ${yahooTicker}`);
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
  if (!timestamps?.length || !quote) {
    throw new Error(`Yahoo missed ${yahooTicker}: no daily bars returned`);
  }

  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close?.[i] ?? null;
    if (close === null || close === undefined) continue;
    bars.push({
      barDate: utcDate(timestamps[i]!),
      open: quote.open?.[i] ?? null,
      high: quote.high?.[i] ?? null,
      low: quote.low?.[i] ?? null,
      close,
      volume: quote.volume?.[i] ?? null,
    });
  }

  if (bars.length === 0) {
    throw new Error(`Yahoo missed ${yahooTicker}: bars had no closes`);
  }

  return bars;
}
