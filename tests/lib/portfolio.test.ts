import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/portfolio/route";
import { proxy } from "@/proxy";
import { SESSION_COOKIE, signSession } from "@/auth/session";
import { applyPortfolioEdit, emptyRecord } from "@/lib/portfolio";

const maybank = { ticker: "MAYBANK", shares: 25, averagePrice: 9.50 };
const taann = { ticker: "TAANN", shares: 100, averagePrice: 4.25 };
const url = "https://genesis.example/api/portfolio";
function write(revision: number, edit: unknown, origin = "https://genesis.example") {
  return PUT(new NextRequest(url, {
    method: "PUT",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ revision, edit }),
  }));
}

beforeEach(() => {
  for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) vi.stubEnv(name, undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("portfolio", () => {
  it("imports missing tickers without replacing holdings, doubling shares, or reviving removed entries", () => {
    let record = applyPortfolioEdit(emptyRecord, { kind: "migrate", holdings: [maybank], starred: ["TAANN", "MAYBANK"] });
    record = applyPortfolioEdit(record, { kind: "starred", starred: ["MAYBANK"] });
    record = applyPortfolioEdit(record, { kind: "holdings", holdings: [{ ...maybank, shares: 50 }] });
    const legacy = { kind: "migrate" as const, holdings: [maybank, taann], starred: ["TAANN", "MAYBANK", "TENAGA"] };
    record = applyPortfolioEdit(applyPortfolioEdit(record, legacy), legacy);
    expect(record.holdings).toEqual([{ ...maybank, shares: 50 }, taann]);
    expect(record.starred).toEqual(["MAYBANK", "TENAGA"]);
    record = applyPortfolioEdit(record, { kind: "holdings", holdings: [] });
    expect(applyPortfolioEdit(record, legacy).holdings).toEqual([]);
  });

  it("uses browser mode only if Redis is not configured", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ mode: "browser" });
    expect((await write(0, { kind: "starred", starred: ["TAANN"] })).status).toBe(503);
    vi.stubEnv("KV_REST_API_URL", "https://redis.example");
    vi.stubEnv("KV_REST_API_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "offline" })));
    expect((await GET()).status).toBe(503);
  });

  it("saves across requests and rejects cross-origin, invalid, and stale or racing edits", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://redis.example");
    vi.stubEnv("KV_REST_API_TOKEN", "test-token");
    let raw = "";
    const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) => {
      const [command, , , , expected, next] = JSON.parse(init!.body as string);
      if (command === "GET") return Response.json({ result: raw || null });
      if (command !== "EVAL") throw new Error("Unexpected command");
      if (expected !== raw) return Response.json({ result: 0 });
      raw = next;
      return Response.json({ result: 1 });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await write(0, { kind: "starred", starred: ["TAANN"] }, "https://elsewhere.example")).status).toBe(403);
    expect((await write(0, { kind: "holdings", holdings: [{ ...maybank, shares: 0 }] })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await write(0, { kind: "holdings", holdings: [maybank] })).status).toBe(200);
    const racing = await Promise.all([
      write(1, { kind: "starred", starred: ["TAANN"] }),
      write(1, { kind: "starred", starred: ["TENAGA"] }),
    ]);
    expect(racing.map(response => response.status).sort()).toEqual([200, 409]);
    expect((await write(0, { kind: "holdings", holdings: [] })).status).toBe(409);
    const winner = await racing.find(response => response.ok)!.json();
    expect(await (await GET()).json()).toEqual(winner);
    expect(winner.portfolio).toEqual({ revision: 2, holdings: [maybank], starred: expect.any(Array) });
    expect(fetch).toHaveBeenCalledWith("https://redis.example", expect.objectContaining({
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      cache: "no-store",
    }));
  });

  it.each(["GET", "PUT"])("protects portfolio %s with the existing signed session", async method => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    vi.stubEnv("SESSION_SECRET", "test-secret");
    expect((await proxy(new NextRequest(url, { method }))).status).toBe(401);
    const cookie = await signSession(process.env);
    const response = await proxy(new NextRequest(url, { method, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
