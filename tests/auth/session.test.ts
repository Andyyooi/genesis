import { describe, expect, it } from "vitest";
import { constantTimePasswordEqual, gateDecision, protectionMode, sanitizeNextPath, SESSION_SECONDS, sessionCookieOptions, signSession, verifySession } from "@/auth/session";

const env = { SITE_PASSWORD: "test-shared-password", SESSION_SECRET: "test-signing-secret", NODE_ENV: "production" };
const now = 1_800_000_000_000;

describe("sessions", () => {
  it("signs a 30-day session with a unique nonce", async () => {
    const token = await signSession(env, now);
    expect(token).not.toContain(env.SITE_PASSWORD);
    expect(await verifySession(token, env, now)).toBe(true);
    expect(await signSession(env, now)).not.toBe(token);
    expect(await verifySession(token, env, now + (SESSION_SECONDS - 1) * 1000)).toBe(true);
    expect(await verifySession(token, env, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(await verifySession(token, env, now - 1000)).toBe(false);
  });

  it("rejects tampering and rotated credentials, even with a fixed secret", async () => {
    const token = await signSession(env, now);
    expect(await verifySession(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), env, now)).toBe(false);
    expect(await verifySession(token, { ...env, SITE_PASSWORD: "changed" }, now)).toBe(false);
    expect(await verifySession(token, { ...env, SESSION_SECRET: "changed" }, now)).toBe(false);
    expect(await verifySession(token, {}, now)).toBe(false);
  });

  it("derives a key from the password when no secret is supplied", async () => {
    const fallback = { SITE_PASSWORD: "test-password" };
    const token = await signSession(fallback, now);
    expect(await verifySession(token, fallback, now)).toBe(true);
    expect(await verifySession(token, { SITE_PASSWORD: "other" }, now)).toBe(false);
  });

  it.each([undefined, "", "bad", "v1.9999999999.no.signature", "a".repeat(10000)])("rejects malformed token %s", async (token) => {
    expect(await verifySession(token, env, now)).toBe(false);
  });

  it("cannot sign without a password", async () => {
    await expect(signSession({})).rejects.toThrow("not configured");
  });

  it("compares passwords including empty, Unicode and different lengths", async () => {
    expect(await constantTimePasswordEqual("secret", "secret")).toBe(true);
    expect(await constantTimePasswordEqual("é", "é")).toBe(true);
    expect(await constantTimePasswordEqual("", "secret")).toBe(false);
    expect(await constantTimePasswordEqual("secrex", "secret")).toBe(false);
    expect(await constantTimePasswordEqual("secret-extra", "secret")).toBe(false);
  });

  it("sets restrictive cookie attributes in production and on Vercel", () => {
    expect(sessionCookieOptions(env)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
    expect(sessionCookieOptions({ VERCEL: "1" }).secure).toBe(true);
    expect(sessionCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
  });
});

describe("next paths", () => {
  it.each(["/", "/market", "/stock/MAYBANK?tab=financials#price", "/export/MAYBANK/quick"]) ("accepts %s", (path) => {
    expect(sanitizeNextPath(path)).toBe(path);
  });
  it.each([undefined, null, "", ["/market"], "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/a/..//evil.test", "/%0d%0aLocation:evil", "/login", "/login/submit", "/%", "javascript:alert(1)"]) ("rejects unsafe input %s", (path) => {
    expect(sanitizeNextPath(path)).toBe("/");
  });
});

describe("gate decisions", () => {
  it("disables only in development when the password is absent", () => {
    expect(protectionMode({ NODE_ENV: "development" })).toBe("disabled");
    expect(protectionMode({ NODE_ENV: "production" })).toBe("unconfigured");
    expect(protectionMode({ NODE_ENV: "development", VERCEL: "1" })).toBe("unconfigured");
    expect(protectionMode(env)).toBe("enabled");
  });
  it.each(["/", "/stock/MAYBANK", "/export/MAYBANK/full", "/logout", "/secret.csv", "/_next/image", "/login/other"]) ("gates page/download %s", async (path) => {
    expect(await gateDecision(path, "GET", undefined, env)).toBe("redirect");
    expect(await gateDecision(path, "POST", "bad", env)).toBe("redirect");
    expect(await gateDecision(path, "GET", undefined, { NODE_ENV: "production" })).toBe("unconfigured");
  });
  it.each(["/api", "/api/refresh-research", "/api/refresh-research/watchlist"]) ("rejects API %s", async (path) => {
    expect(await gateDecision(path, "POST", undefined, env)).toBe("unauthorized");
    expect(await gateDecision(path, "GET", "invalid", env)).toBe("unauthorized");
  });
  it.each([["/login", "GET"], ["/login", "HEAD"], ["/login/submit", "POST"], ["/_next/static/chunk.js", "GET"], ["/favicon.ico", "GET"]])("allows public %s %s", async (path, method) => {
    expect(await gateDecision(path, method, undefined, env)).toBe("allow");
  });
  it("does not allow arbitrary login methods or lookalike asset paths", async () => {
    expect(await gateDecision("/login/submit", "GET", undefined, env)).toBe("redirect");
    expect(await gateDecision("/login", "POST", undefined, env)).toBe("redirect");
    expect(await gateDecision("/_next/static-secret", "GET", undefined, env)).toBe("redirect");
    expect(await gateDecision("/favicon.ico/private", "GET", undefined, env)).toBe("redirect");
  });
  it("allows valid sessions and dev requests, never missing production credentials", async () => {
    const token = await signSession(env);
    expect(await gateDecision("/export/MAYBANK/full", "GET", token, env)).toBe("allow");
    expect(await gateDecision("/api/refresh-research", "POST", token, env)).toBe("allow");
    expect(await gateDecision("/", "GET", undefined, {})).toBe("allow");
    expect(await gateDecision("/", "GET", token, { VERCEL: "1" })).toBe("unconfigured");
  });
});
