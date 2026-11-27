import { afterEach, describe, expect, it, vi } from "vitest";
import { inProgressSessionDate } from "@/ingest/price-bar";
import { fetchYahooDailyBars, usableYahooDailyBar, type YahooBar } from "@/ingest/providers/yahoo-prices";

function bar(overrides: Partial<YahooBar> = {}): YahooBar {
  return {
    barDate: "2026-10-12",
    open: 10,
    high: 11,
    low: 9,
    close: 10.5,
    volume: 100,
    adjClose: 10.5,
    ...overrides,
  };
}

function chart(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("Yahoo daily bar validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads ex-date and amount from the same chart, without certifying malformed history", async () => {
    const timestamp = ["2025-10-01", "2026-09-01", "2026-11-27"].map(day => Date.parse(day) / 1000);
    const result = {
      meta: { symbol: "5012.KL", currency: "MYR" },
      timestamp,
      indicators: { quote: [{ close: [5, 5, 5] }] },
      events: { dividends: { abc: { date: timestamp[1], amount: 0.15 }, def: { date: timestamp[1], amount: 0.15 } } },
    };
    const request = chart({ chart: { result: [result] } });
    vi.stubGlobal("fetch", request);
    const options = { now: () => new Date("2026-11-27T10:00:00Z") };
    const fetched = await fetchYahooDailyBars("5012.KL", "2y", options);
    expect(request).toHaveBeenCalledTimes(1);
    expect(new URL(String((request.mock.calls as unknown[][])[0][0])).searchParams.get("events")).toBe("div,splits");
    expect(fetched.dividendCoverage).toEqual({
      symbol: "5012.KL", currency: "MYR", from: "2025-10-01", through: "2026-11-27",
      events: [
        { sourceId: "abc", exDate: "2026-09-01", amount: 0.15 },
        { sourceId: "def", exDate: "2026-09-01", amount: 0.15 },
      ],
    });
    vi.stubGlobal("fetch", chart({ chart: { result: [{ ...result, events: { dividends: { abc: { date: timestamp[1] } } } }] } }));
    expect((await fetchYahooDailyBars("5012.KL", "2y", options)).dividendCoverage).toBeUndefined();
    vi.stubGlobal("fetch", chart({ chart: { result: [{ ...result, events: undefined }] } }));
    expect((await fetchYahooDailyBars("5012.KL", "2y", options)).dividendCoverage?.events).toEqual([]);
  });

  it("accepts a finite positive close on a real trading date", () => {
    expect(usableYahooDailyBar(bar(), new Date("2026-10-13T00:00:00.000Z"))).toBe(true);
  });

  it("rejects empty, non-numeric, non-positive, and unusable dates", () => {
    const now = new Date("2026-10-13T00:00:00.000Z");
    expect(usableYahooDailyBar(bar({ close: Number.NaN }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ close: 0 }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ close: -2 }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ barDate: "not-a-date" }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ barDate: "2026-02-31" }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ barDate: "1970-01-01" }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ barDate: "2099-01-01" }), now)).toBe(false);
    expect(usableYahooDailyBar(bar({ high: Number.POSITIVE_INFINITY }), now)).toBe(false);
  });

  it("turns HTTP errors and empty or malformed charts into fetch failures", async () => {
    vi.stubGlobal("fetch", chart({ chart: { error: { description: "Not Found" } } }, 404));
    await expect(fetchYahooDailyBars("MISSING.KL", "5d")).rejects.toThrow(/HTTP 404|Not Found/);

    vi.stubGlobal("fetch", chart({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } }));
    await expect(fetchYahooDailyBars("MAYBANK.KL", "5d")).rejects.toThrow(/no daily bars/);

    const epoch = Date.parse("2026-10-12T00:00:00.000Z") / 1000;
    vi.stubGlobal(
      "fetch",
      chart({
        chart: {
          result: [{ timestamp: [epoch, Number.NaN], indicators: { quote: [{ close: [null, 10] }] } }],
        },
      }),
    );
    await expect(fetchYahooDailyBars("MAYBANK.KL", "5d")).rejects.toThrow(/no closes/);
  });

  it("requests an exact start date through now without a fixed range", async () => {
    const request = chart({ chart: { result: [{ timestamp: [], indicators: { quote: [{}] } }] } });
    vi.stubGlobal("fetch", request);
    const before = Math.floor(Date.now() / 1000);
    await expect(fetchYahooDailyBars("MAYBANK.KL", { startDate: "2024-01-02" })).rejects.toThrow("no daily bars");
    const url = new URL(String((request.mock.calls as unknown[][])[0][0]));
    expect(url.searchParams.get("period1")).toBe(String(Date.parse("2024-01-02T00:00:00Z") / 1000));
    expect(Number(url.searchParams.get("period2"))).toBeGreaterThanOrEqual(before);
    expect(url.searchParams.has("range")).toBe(false);
  });

  it("keeps a valid bar and drops an invalid one from the same response", async () => {
    const good = Date.parse("2026-10-12T00:00:00.000Z") / 1000;
    const future = Date.parse("2099-01-01T00:00:00.000Z") / 1000;
    vi.stubGlobal(
      "fetch",
      chart({
        chart: {
          result: [
            {
              timestamp: [good, future],
              indicators: { quote: [{ close: [10.25, -5], open: [10, 1], high: [11, 1], low: [9, 1], volume: [50, 1] }] },
            },
          ],
        },
      }),
    );
    const bars = await fetchYahooDailyBars("MAYBANK.KL", "5d");
    expect(bars).toEqual([
      expect.objectContaining({ barDate: "2026-10-12", close: 10.25 }),
    ]);
  });

  it("marks the first usable bar on or after a reported split", async () => {
    const split = Date.parse("2026-10-13T01:00:00Z") / 1000;
    vi.stubGlobal("fetch", chart({
      chart: {
        result: [{
          timestamp: [split - 86400, split, split + 86400, split + 172800],
          events: { splits: { [split]: { date: split, numerator: 2, denominator: 1 } } },
          indicators: { quote: [{ close: [5, null, 5, 5] }] },
        }],
      },
    }));
    const bars = await fetchYahooDailyBars("MAYBANK.KL", "5d");
    expect(bars.map(({ split }) => split)).toEqual([undefined, true, undefined]);
  });
});

describe("Yahoo retries and unfinished sessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const day = (date: string) => Date.parse(`${date}T01:00:00Z`) / 1000;
  const body = (dates: string[]) => ({
    chart: { result: [{ timestamp: dates.map(day), indicators: { quote: [{ open: dates.map(() => 10), high: dates.map(() => 10), low: dates.map(() => 10), close: dates.map(() => 10), volume: dates.map(() => 100) }] } }] },
  });

  it("knows when Bursa's session for today has not settled (before 5:30 PM Malaysia time)", () => {
    expect(inProgressSessionDate(new Date("2026-11-27T01:16:00Z"))).toBe("2026-11-27");
    expect(inProgressSessionDate(new Date("2026-11-27T09:29:00Z"))).toBe("2026-11-27");
    expect(inProgressSessionDate(new Date("2026-11-27T09:30:00Z"))).toBeNull();
    expect(inProgressSessionDate(new Date("2026-11-26T17:00:00Z"))).toBe("2026-11-27");
  });

  it("drops the bar for a session still trading but keeps finished closes", async () => {
    vi.stubGlobal("fetch", chart(body(["2026-11-26", "2026-11-27"])));
    const midSession = await fetchYahooDailyBars("MAYBANK.KL", "5d", { now: () => new Date("2026-11-27T02:00:00Z") });
    expect(midSession.map((b) => b.barDate)).toEqual(["2026-11-26"]);
    const afterClose = await fetchYahooDailyBars("MAYBANK.KL", "5d", { now: () => new Date("2026-11-27T10:00:00Z") });
    expect(afterClose.map((b) => b.barDate)).toEqual(["2026-11-26", "2026-11-27"]);
  });

  it("retries rate limits, server errors and network failures, then gives up", async () => {
    const ok = () => new Response(JSON.stringify(body(["2026-11-26"])), { status: 200 });
    const flaky = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementation(async () => ok());
    vi.stubGlobal("fetch", flaky);
    const bars = await fetchYahooDailyBars("MAYBANK.KL", "5d", { retryDelaysMs: [0, 0], now: () => new Date("2026-11-27T10:00:00Z") });
    expect(bars).toHaveLength(1);
    expect(flaky).toHaveBeenCalledTimes(3);

    const down = chart({}, 503);
    vi.stubGlobal("fetch", down);
    await expect(fetchYahooDailyBars("MAYBANK.KL", "5d", { retryDelaysMs: [0, 0] })).rejects.toThrow(/503/);
    expect(down).toHaveBeenCalledTimes(3);

    const missing = chart({ chart: { error: { description: "Not Found" } } }, 404);
    vi.stubGlobal("fetch", missing);
    await expect(fetchYahooDailyBars("MISSING.KL", "5d", { retryDelaysMs: [0, 0] })).rejects.toThrow();
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
