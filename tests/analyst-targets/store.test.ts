import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { getAnalystTargetStore, localAnalystTargetStore, redisAnalystTargetStore } from "@/analyst-targets/store";

const first = { ticker: "TAANN", broker: "Broker", date: "2026-08-27", target: 5.25, source_url: "https://example.com/report" };
const revision = { ...first, broker: "BROKER", target: 5.5 };
const latest = { ...first, date: "2026-09-09", target: 5.75 };
const anotherStock = { ...first, ticker: "MAYBANK" };

it("persists multiple dated reports across store instances and replaces the same ticker, broker and date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "genesis-analyst-"));
  const path = join(dir, "targets.db");
  try {
    await localAnalystTargetStore(path).save([first, latest, anotherStock, revision]);
    expect((await localAnalystTargetStore(path).list("TAANN")).sort((a, b) => a.date.localeCompare(b.date))).toEqual([revision, latest]);
    expect(await localAnalystTargetStore(path).list("MAYBANK")).toEqual([anotherStock]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("reads only the requested ticker and batches Redis writes in a transaction under separate keys", async () => {
  const base = "https://test.invalid";
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ result: 1 }, { result: 1 }]))
    .mockResolvedValueOnce(Response.json({ result: [JSON.stringify(first)] }));
  const store = redisAnalystTargetStore(base, "test-token", request);
  await store.save([first, anotherStock]);
  expect(request.mock.calls[0][0]).toBe(`${base}/multi-exec`);
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual([
    ["HSET", "genesis:analyst-targets:v1:TAANN", '["broker","2026-08-27"]', JSON.stringify(first)],
    ["HSET", "genesis:analyst-targets:v1:MAYBANK", '["broker","2026-08-27"]', JSON.stringify(anotherStock)],
  ]);
  expect(await store.list("TAANN")).toEqual([first]);
  expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual(["HVALS", "genesis:analyst-targets:v1:TAANN"]);
});

it("reports Redis failures and does not fall back to ephemeral production storage", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ error: "WRONGTYPE" }]));
  await expect(redisAnalystTargetStore("https://test.invalid", "test-token", request).save([first])).rejects.toThrow("storage command failed");
  expect(getAnalystTargetStore({ VERCEL: "1", KV_REST_API_URL: "https://test.invalid" })).toBeNull();
  expect(getAnalystTargetStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://test.invalid", UPSTASH_REDIS_REST_TOKEN: "test-token" })).not.toBeNull();
});

it("keeps valid reports when stored data includes an oversized source link or invalid JSON", async () => {
  const oversized = { ...first, source_url: new URL("https://example.com/" + "界".repeat(228)).href };
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
    result: [JSON.stringify(oversized), JSON.stringify(first), "not JSON", JSON.stringify(latest)],
  }));
  expect(await redisAnalystTargetStore("https://test.invalid", "test-token", request).list("TAANN")).toEqual([first, latest]);
});
