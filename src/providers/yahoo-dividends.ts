export type DividendYear = {
  year: number;
  perShare: number | null;
  payments: number;
  toDate: boolean;
};

export type DividendHistory = {
  symbol: string;
  currency: string;
  checkedAt: string;
  years: DividendYear[];
};

type Chart = {
  chart?: {
    error?: unknown;
    result?: {
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      events?: { dividends?: Record<string, { date?: number; amount?: number }> };
    }[];
  };
};

/** Five calendar years, including the current year to date. Missing reports are never zero. */
export function parseDividendHistory(body: unknown, now = new Date()): DividendHistory {
  const chart = (body as Chart | null)?.chart;
  const result = chart?.result?.[0];
  const currency = result?.meta?.currency;
  const symbol = result?.meta?.symbol;
  if (chart?.error || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) ||
      typeof symbol !== "string" || !Array.isArray(result?.timestamp) ||
      !result.timestamp.some(time => Number.isFinite(time) && time > 0)) {
    throw new Error("Dividend history was unavailable");
  }
  const currentYear = now.getUTCFullYear();
  const years: DividendYear[] = Array.from({ length: 5 }, (_, index) => ({
    year: currentYear - index, perShare: null, payments: 0, toDate: index === 0,
  }));
  const seen = new Set<string>();
  for (const event of Object.values(result.events?.dividends ?? {})) {
    if (!event || typeof event.date !== "number" || !Number.isFinite(event.date)) {
      throw new Error("A dividend date was missing");
    }
    const date = new Date(event.date * 1000);
    if (!Number.isFinite(date.getTime())) throw new Error("A dividend date was invalid");
    const row = years.find(row => row.year === date.getUTCFullYear());
    if (!row || date > now) continue;
    if (typeof event.amount !== "number" || !Number.isFinite(event.amount) || event.amount <= 0) {
      throw new Error("A dividend amount was missing");
    }
    const key = `${event.date}:${event.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    row.perShare = (row.perShare ?? 0) + event.amount;
    row.payments++;
  }
  return { symbol, currency, checkedAt: now.toISOString(), years };
}

const cache = new Map<string, { until: number; value: DividendHistory }>();
const pending = new Map<string, Promise<DividendHistory>>();
const TTL = 6 * 60 * 60 * 1000;

/** Read-only chart request: no holdings, credentials or portfolio amounts leave Genesis. */
export async function loadDividendHistory(symbol: string): Promise<DividendHistory> {
  const now = new Date();
  const key = `${symbol}:${now.getUTCFullYear()}`;
  const hit = cache.get(key);
  if (hit && hit.until > now.getTime()) return hit.value;
  const running = pending.get(key);
  if (running) return running;
  const request = (async () => {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.search = new URLSearchParams({
      interval: "1mo", events: "div",
      period1: String(Date.UTC(now.getUTCFullYear() - 4, 0, 1) / 1000),
      period2: String(Math.ceil(now.getTime() / 1000)),
    }).toString();
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", Accept: "application/json" },
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!response.ok) throw new Error("Dividend history is unavailable right now");
    const value = parseDividendHistory(await response.json(), now);
    if (value.symbol.toUpperCase() !== symbol.toUpperCase()) throw new Error("Dividend symbol did not match");
    cache.set(key, { until: Date.now() + TTL, value });
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
