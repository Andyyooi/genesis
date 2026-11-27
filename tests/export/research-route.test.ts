import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/export/route";
import { SESSION_COOKIE, signSession } from "@/auth/session";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({ picks: vi.fn(), ranges: vi.fn(), buy: vi.fn() }));
vi.mock("@/opportunities/top-picks", () => ({ loadTopPicks: mocks.picks }));
vi.mock("@/fair-value/load-list-ranges", () => ({ loadListFairRanges: mocks.ranges }));
vi.mock("@/scoring/published-research-scores", () => ({ publishedBuyScore: mocks.buy }));

function request(authorization?: string, path = "/api/export", method = "GET", cookie?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (cookie) headers.set("Cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(`https://research.test${path}`, { method, headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SITE_PASSWORD", "site-password");
  vi.stubEnv("EXPORT_API_TOKEN", "test-export-token");
});

afterEach(() => vi.unstubAllEnvs());

describe("research export authentication", () => {
  it.each([undefined, "Basic test-export-token", "Bearer wrong", "Bearer test-export-token-extra", "Bearer test-export-token, Bearer wrong"])(
    "rejects %s in the handler and proxy even with a valid site session",
    async (authorization) => {
      const req = request(authorization, undefined, undefined, await signSession(process.env));
      for (const response of [await proxy(req), GET(req)]) {
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toMatch(/^Bearer/);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
      expect(mocks.picks).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "  "])("fails closed when the token is %s even without a dev site password", async (token) => {
    vi.stubEnv("EXPORT_API_TOKEN", token);
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    const req = request("Bearer test-export-token");
    expect((await proxy(req)).status).toBe(503);
    expect(GET(req).status).toBe(503);
    expect(mocks.picks).not.toHaveBeenCalled();
  });

  it("accepts a configured token containing punctuation", async () => {
    vi.stubEnv("EXPORT_API_TOKEN", "  export!#%&:@  ");
    mocks.picks.mockReturnValue({ summary: null, priceDate: null, picks: [] });
    mocks.ranges.mockReturnValue({});
    const req = request("bEaReR   export!#%&:@");
    expect((await proxy(req)).headers.get("x-middleware-next")).toBe("1");
    expect(GET(req).status).toBe(200);
  });

  it("allows the token only for GET /api/export", async () => {
    const authorization = "bearer test-export-token";
    expect((await proxy(request(authorization))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(request(authorization, "/api/export/details"))).status).toBe(401);
    expect((await proxy(request(authorization, "/api/holdings"))).status).toBe(401);
    expect((await proxy(request(authorization, "/api/export", "POST"))).status).toBe(401);
    expect((await proxy(request(authorization, "/market"))).status).toBe(303);
    expect(GET(request(authorization, "/api/export", "HEAD")).status).toBe(405);
    expect(mocks.picks).not.toHaveBeenCalled();
  });
});

describe("research export data", () => {
  it("serializes published picks in order and leaves unavailable values null", async () => {
    const cases = [
      { ticker: "BELOW", price: 8, position: "below", percent: 20 },
      { ticker: "INSIDE", price: 15, position: "inside", percent: 50 },
      { ticker: "ABOVE", price: 24, position: "above", percent: 20 },
      { ticker: "NO_RANGE", price: 10 },
    ];
    mocks.picks.mockReturnValue({
      summary: { asOf: "2026-11-27T10:23:00Z" },
      priceDate: "2026-11-27",
      picks: cases.map(({ ticker, price }) => ({
        ticker, name: ticker, lastClose: price,
        result: { researchScore: 72, eligibility: { eligible: true }, dataConfidence: { needsVerification: false } },
      })),
    });
    mocks.ranges.mockReturnValue(Object.fromEntries(cases.map(({ ticker, price, position }) => [
      ticker, position ? { available: true, low: 10, high: 20, price, position } : { available: false },
    ])));
    mocks.buy.mockReturnValue({ available: true, score: 96, capped: false });

    const response = GET(request("Bearer test-export-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      schema: "bursa-research.research-export.v1",
      disclaimer: "Research only, not a buy or sell instruction.",
      asOfDate: "2026-11-27",
      researchAsOf: "2026-11-27T10:23:00Z",
      topPicks: cases.map(({ ticker, price, position, percent }) => ({
        ticker, name: ticker, lastClose: price, researchScore: 72, buyRank: 96,
        fairRange: position ? { low: 10, high: 20 } : null,
        pricePosition: position ? { position, percent, price } : null,
      })),
      holdings: null,
    });
    expect(mocks.picks).toHaveBeenCalledWith();
    expect(mocks.ranges).toHaveBeenCalledWith(cases.map(({ ticker }) => ticker));
    expect(mocks.buy).toHaveBeenCalledWith({ researchScore: 72, eligible: true, needsVerification: false });
  });

  it("returns a generic 503 without exposing research data errors", async () => {
    mocks.picks.mockImplementation(() => { throw new Error("internal database path"); });
    const response = GET(request("Bearer test-export-token"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cannot read saved research data." });
  });
});
