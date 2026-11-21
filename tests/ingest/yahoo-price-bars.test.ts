import { afterEach, describe, expect, it, vi } from "vitest";
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
});
