import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDividendHistory, parseDividendHistory } from "@/providers/yahoo-dividends";

const now = new Date("2026-11-22T00:00:00Z");
const event = (date: string, amount: number) => ({ date: Date.parse(`${date}T01:00:00Z`) / 1000, amount });
const body = (dividends: Record<string, unknown> = {}, symbol = "1155.KL", currency = "MYR") => ({ chart: { result: [{
  meta: { symbol, currency }, timestamp: [Date.parse("2022-01-03") / 1000], events: { dividends },
}] } });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("five-year payment history", () => {
  it("sums separate payouts by ex-dividend calendar year, retaining half-sen precision", () => {
    const a = event("2025-03-01", 0.315);
    const result = parseDividendHistory(body({ a, duplicate: a, b: event("2025-09-01", 0.3), c: event("2026-03-01", 0.33),
      old: event("2021-12-31", 10), future: event("2026-12-01", 10) }), now);
    expect(result.years.map(row => row.year)).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(result.years[0]).toEqual({ year: 2026, toDate: true, perShare: 0.33, payments: 1 });
    expect(result.years[1].perShare).toBeCloseTo(0.615, 12);
    expect(result.years[1].payments).toBe(2);
    expect(result.years[2].perShare).toBeNull();
  });

  it("never converts absent coverage to a known zero or accepts incomplete payment amounts", () => {
    expect(parseDividendHistory(body(), now).years.every(row => row.perShare === null)).toBe(true);
    for (const amount of [NaN, Infinity, -1, 0, undefined]) {
      expect(() => parseDividendHistory(body({ bad: { ...event("2025-03-01", 1), amount } }), now)).toThrow();
    }
    expect(() => parseDividendHistory(body({ bad: { amount: 1 } }), now)).toThrow();
    expect(() => parseDividendHistory({ chart: { error: { code: "Not Found" } } }, now)).toThrow();
    expect(() => parseDividendHistory(body({}, "1155.KL", ""), now)).toThrow();
  });

  it("requests complete calendar years and deduplicates concurrent loads, without storing failures", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body({ a: event("2026-03-01", 0.33) }, "CACHE.KL"))));
    vi.stubGlobal("fetch", fetcher);
    const [first, second] = await Promise.all([loadDividendHistory("CACHE.KL"), loadDividendHistory("CACHE.KL")]);
    expect(first).toEqual(second);
    await loadDividendHistory("CACHE.KL");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("period1")).toBe(String(Date.UTC(2022, 0, 1) / 1000));
    expect(url.searchParams.get("events")).toBe("div");
    fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 429 }));
    await expect(loadDividendHistory("RETRY.KL")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body({}, "RETRY.KL"))));
    expect((await loadDividendHistory("RETRY.KL")).symbol).toBe("RETRY.KL");
  });
});
