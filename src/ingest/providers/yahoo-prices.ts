export type YahooBar = {
  barDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjClose: number | null;
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
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
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

export async function fetchYahooDailyBars(yahooTicker: string, range = "5y"): Promise<YahooBar[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", range);
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

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
      adjClose: adjSeries?.[i] ?? null,
    });
  }

  if (bars.length === 0) {
    throw new Error(`Yahoo missed ${yahooTicker}: bars had no closes`);
  }

  return bars;
}
