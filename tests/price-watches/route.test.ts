import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PUT } from "@/app/api/price-watches/[ticker]/route";

const mocks = vi.hoisted(() => ({ store: vi.fn(), instrument: vi.fn(), closes: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("@/price-watches/store", async (original) => ({
  ...await original<typeof import("@/price-watches/store")>(),
  getPriceWatchStore: mocks.store,
}));
vi.mock("@/price-watches/snapshot", () => ({ loadWatchInstrument: mocks.instrument, loadWatchCloses: mocks.closes }));

const site = "https://genesis.test";
const params = { params: Promise.resolve({ ticker: "TEST" }) };
function request(method: string, body?: unknown, origin = site) {
  return new NextRequest(`${site}/api/price-watches/TEST`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { origin, "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.store.mockReturnValue({ save: mocks.save, remove: mocks.remove });
  mocks.instrument.mockReturnValue({ id: 1 });
  mocks.closes.mockReturnValue([{ date: "2026-11-23", close: 3 }]);
});

describe("price watch writes", () => {
  it("rejects cross-site writes and malformed or unknown watches", async () => {
    expect((await PUT(request("PUT", { kind: "target", target: 2.5 }, "https://other.test"), params)).status).toBe(403);
    expect((await DELETE(request("DELETE", undefined, "https://other.test"), params)).status).toBe(403);
    expect((await PUT(request("PUT", { kind: "target", target: -1 }), params)).status).toBe(400);
    mocks.instrument.mockReturnValue(undefined);
    expect((await PUT(request("PUT", { kind: "target", target: 2.5 }), params)).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("saves the fair-range start date from the current snapshot, then supports deletion", async () => {
    const reply = await PUT(request("PUT", { kind: "fair-range", startCloseDate: "2000-01-01" }), params);
    const watch = { ticker: "TEST", kind: "fair-range", startCloseDate: "2026-11-23" };
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ watch });
    expect(mocks.save).toHaveBeenCalledWith(watch);
    expect((await DELETE(request("DELETE"), params)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("TEST");
  });

  it("returns unavailable instead of claiming a save when Redis is not configured", async () => {
    mocks.store.mockReturnValue(null);
    const reply = await PUT(request("PUT", { kind: "target", target: 2.5 }), params);
    expect(reply.status).toBe(503);
    expect(await reply.json()).toEqual({ error: "Price watches aren’t set up on this server." });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
