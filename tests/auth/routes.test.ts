import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { POST as login } from "@/app/login/submit/route";
import { POST as logout } from "@/app/logout/route";
import { SESSION_COOKIE, verifySession } from "@/auth/session";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function form(password: string, next = "/market", origin = "https://research.test") {
  return new NextRequest("https://research.test/login/submit", {
    method: "POST", headers: { origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password, next }),
  });
}

describe("authentication routes", () => {
  it("logs in through the public host when the server URL uses an internal bind address", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    vi.stubEnv("NODE_ENV", "production");
    const response = await login(new NextRequest("http://0.0.0.0:43147/login/submit", { method: "POST", headers: { host: "localhost:43147", origin: "http://localhost:43147", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: "test-password", next: "/market" }) }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:43147/market");
    expect(await verifySession(response.cookies.get(SESSION_COOKIE)?.value, process.env)).toBe(true);
  });
  it("logs in and logs out with safe cookies and redirects", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    vi.stubEnv("NODE_ENV", "production");
    const response = await login(form("test-password"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://research.test/market");
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(await verifySession(cookie.value, process.env)).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    const exit = await logout(new NextRequest("https://research.test/logout", { method: "POST", headers: { origin: "https://research.test" } }));
    expect(exit.cookies.get(SESSION_COOKIE)?.value).toBe("");
    expect(exit.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("delays incorrect passwords and returns the login error without a session", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    const started = Date.now();
    const pending = login(form("wrong", "//evil.test"));
    const response = await pending;
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://research.test/login?next=%2F&error=1");
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects cross-origin or malformed submissions", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    expect((await login(form("test-password", "/", "https://evil.test"))).status).toBe(403);
    expect((await login(new NextRequest("https://research.test/login/submit", { method: "POST", headers: { origin: "https://research.test" }, body: "invalid" }))).status).toBe(400);
    expect((await logout(new NextRequest("https://research.test/logout", { method: "POST" }))).status).toBe(403);
  });

  it("fails closed without production credentials and allows dev without issuing tokens", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await login(form("anything"))).status).toBe(503);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    const response = await login(form("anything"));
    expect(response.status).toBe(303);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe("proxy responses", () => {
  it("redirects pages/downloads and returns JSON 401 for APIs", async () => {
    vi.stubEnv("SITE_PASSWORD", "test-password");
    const page = await proxy(new NextRequest("https://research.test/export/MAYBANK/full?format=csv"));
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("https://research.test/login?next=%2Fexport%2FMAYBANK%2Ffull%3Fformat%3Dcsv");
    const api = await proxy(new NextRequest("https://research.test/api/refresh-research", { method: "POST" }));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Authentication required" });
  });

  it("serves only the unavailable page/JSON when production is unconfigured", async () => {
    vi.stubEnv("SITE_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");
    const page = await proxy(new NextRequest("https://research.test/"));
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("The site password isn't configured");
    expect((await proxy(new NextRequest("https://research.test/api/refresh-research"))).status).toBe(503);
  });
});
