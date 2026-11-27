import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getPriceWatchStore, localPriceWatchStore, redisPriceWatchStore } from "@/price-watches/store";
import type { PriceWatch } from "@/price-watches/watch";

const target: PriceWatch = { ticker: "TEST", kind: "target", target: 2.5 };
const fair: PriceWatch = { ticker: "TEST", kind: "fair-range", startCloseDate: "2026-11-23" };

describe("price watch storage", () => {
  it("persists across SQLite connections, replaces one ticker and removes only that ticker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-price-watches-"));
    try {
      const path = join(dir, "watches.db");
      const writer = localPriceWatchStore(path);
      const reader = localPriceWatchStore(path);
      expect(await reader.get(target.ticker)).toBeNull();
      await writer.save(target);
      await writer.save({ ...target, ticker: "OTHER" });
      expect(await reader.get(target.ticker)).toEqual(target);
      await writer.save(fair);
      expect(await reader.list()).toHaveLength(2);
      expect(await reader.get(fair.ticker)).toEqual(fair);
      await writer.remove(fair.ticker);
      expect(await reader.list()).toEqual([{ ...target, ticker: "OTHER" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses independent Redis hash commands over authenticated uncached REST", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ result: null }))
      .mockResolvedValueOnce(Response.json({ result: 1 }))
      .mockResolvedValueOnce(Response.json({ result: [JSON.stringify(target)] }))
      .mockResolvedValueOnce(Response.json({ result: 1 }));
    const store = redisPriceWatchStore("https://redis.test", "test-token", request);
    expect(await store.get(target.ticker)).toBeNull();
    await store.save(target);
    expect(await store.list()).toEqual([target]);
    await store.remove(target.ticker);
    expect(request.mock.calls.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      ["HGET", "genesis:price-watches:v1", "TEST"],
      ["HSET", "genesis:price-watches:v1", "TEST", JSON.stringify(target)],
      ["HVALS", "genesis:price-watches:v1"],
      ["HDEL", "genesis:price-watches:v1", "TEST"],
    ]);
    expect(request).toHaveBeenCalledWith("https://redis.test", expect.objectContaining({
      method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, cache: "no-store",
    }));
  });

  it("surfaces Redis errors and never falls back to disk in production", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "ERR" }));
    await expect(redisPriceWatchStore("https://redis.test", "test-token", request).list()).rejects.toThrow("storage command failed");
    expect(getPriceWatchStore({ NODE_ENV: "production" })).toBeNull();
    expect(getPriceWatchStore({ VERCEL: "1", KV_REST_API_TOKEN: "test-token", UPSTASH_REDIS_REST_URL: "https://redis.test" })).toBeNull();
    expect(getPriceWatchStore({ VERCEL: "1", KV_REST_API_TOKEN: "test-token", KV_REST_API_URL: "https://redis.test" })).not.toBeNull();
    expect(getPriceWatchStore({ NODE_ENV: "production", UPSTASH_REDIS_REST_TOKEN: "test-token", UPSTASH_REDIS_REST_URL: "https://redis.test" })).not.toBeNull();
  });
});
