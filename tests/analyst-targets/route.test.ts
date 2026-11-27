import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES } from "@/analyst-targets/limits";
import { POST } from "@/app/api/analyst-targets/route";

const { save, all } = vi.hoisted(() => ({ save: vi.fn(), all: vi.fn() }));
vi.mock("@/analyst-targets/store", () => ({ getAnalystTargetStore: () => ({ save }) }));
vi.mock("@/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all }) }) }) }),
}));

const url = "http://genesis.test/api/analyst-targets";
const csv = "ticker,broker,target,date,source_url\nTAANN,Broker,4.20,2024-01-27,https://example.com/report";

function post(body: string, type = "text/csv", origin = new URL(url).origin) {
  return POST(new NextRequest(url, { method: "POST", headers: { "Content-Type": type, Origin: origin }, body }));
}

beforeEach(() => {
  vi.clearAllMocks();
  all.mockReturnValue([{ ticker: "TAANN" }]);
});

it("rejects cross-origin writes and oversized or malformed uploads before touching storage", async () => {
  expect((await post(csv, "text/csv", "https://elsewhere.test")).status).toBe(403);
  expect((await post("x".repeat(MAX_IMPORT_BYTES + 1))).status).toBe(413);
  expect((await post("invalid", "application/json")).status).toBe(400);
  expect(all).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it("validates every CSV ticker before saving and returns the processed count", async () => {
  const response = await post(`${csv}\nUNKNOWN,Broker,5,2024-01-27,https://example.com/report`);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Unknown Genesis ticker(s): UNKNOWN." });
  expect(save).not.toHaveBeenCalled();
  const imported = await post(csv);
  expect(imported.status).toBe(200);
  expect(await imported.json()).toEqual({ processed: 1 });
  expect(save).toHaveBeenCalledWith([{ ticker: "TAANN", broker: "Broker", target: 4.2, date: "2024-01-27", source_url: "https://example.com/report" }]);
});

it("accepts a manual entry through the same endpoint", async () => {
  const target = { ticker: "TAANN", broker: "Broker", target: "4.20", date: "2024-01-27", source_url: "https://example.com/report" };
  const response = await post(JSON.stringify(target), "application/json");
  expect(response.status).toBe(200);
  expect(save).toHaveBeenCalledWith([{ ...target, target: 4.2 }]);
});
