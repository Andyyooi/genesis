import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceWatchAlerts } from "@/components/alerts/price-watch-alerts";
import { WATCH_STORE_UNCONFIGURED } from "@/price-watches/store";

const mocks = vi.hoisted(() => ({ store: vi.fn(), instrument: vi.fn(), closes: vi.fn(), range: vi.fn() }));
vi.mock("@/price-watches/store", async (original) => ({
  ...await original<typeof import("@/price-watches/store")>(),
  getPriceWatchStore: mocks.store,
}));
vi.mock("@/price-watches/snapshot", () => ({
  loadWatchInstrument: mocks.instrument, loadWatchCloses: mocks.closes, loadWatchRange: mocks.range,
}));

beforeEach(() => vi.resetAllMocks());

describe("price watches on Alerts", () => {
  it("shows triggered and active watches using the available saved closes", async () => {
    mocks.store.mockReturnValue({ list: async () => [
      { ticker: "NEWENTRY", kind: "fair-range", startCloseDate: "2026-11-23" },
      { ticker: "WAIT", kind: "target", target: 2 },
    ] });
    mocks.instrument.mockImplementation((ticker) => ({ id: ticker === "NEWENTRY" ? 1 : 2 }));
    mocks.closes.mockImplementation((id) => id === 1 ? [
      { date: "2026-11-24", close: 3 }, { date: "2026-11-23", close: 5 },
    ] : [{ date: "2026-11-24", close: 2.5 }]);
    mocks.range.mockReturnValue({ low: 2, high: 4 });
    const html = renderToStaticMarkup(await PriceWatchAlerts());
    expect(html).toMatch(/Triggered watches.*\/stock\/NEWENTRY.*Entered the fair range.*Active watches.*\/stock\/WAIT.*25.0% above the target/);
    expect(html).toContain("2026-11-24");
  });

  it("does not show an empty watch list when production storage is unconfigured", async () => {
    mocks.store.mockReturnValue(null);
    const html = renderToStaticMarkup(await PriceWatchAlerts());
    expect(html).toContain(WATCH_STORE_UNCONFIGURED);
    expect(html).not.toContain("No price watches triggered");
  });
});
