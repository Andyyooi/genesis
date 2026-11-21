import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isSameOrigin, requestOrigin } from "@/auth/origin";

describe("browser-facing request origins", () => {
  it("uses the browser host rather than the next start bind address", () => {
    const request = new NextRequest("http://0.0.0.0:43147/login/submit", { headers: { host: "localhost:43147", origin: "http://localhost:43147" } });
    expect(requestOrigin(request)).toBe("http://localhost:43147");
    expect(isSameOrigin(request)).toBe(true);
  });
  it("supports a forwarding proxy that supplies the public HTTPS origin", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/refresh", { headers: { host: "internal:3000", "x-forwarded-host": "research.test", "x-forwarded-proto": "https", origin: "https://research.test" } });
    expect(isSameOrigin(request)).toBe(true);
    request.headers.set("origin", "http://internal:3000");
    expect(isSameOrigin(request)).toBe(false);
  });
  it("rejects absent/cross-origin requests and malformed forwarded hosts/protocols", () => {
    expect(isSameOrigin(new NextRequest("https://research.test"))).toBe(false);
    expect(isSameOrigin(new NextRequest("https://research.test", { headers: { origin: "https://evil.test" } }))).toBe(false);
    for (const host of ["evil.test,research.test", "evil.test/research.test", "user@research.test", "", "bad host"]) expect(requestOrigin(new NextRequest("https://research.test", { headers: { "x-forwarded-host": host } }))).toBeNull();
    expect(requestOrigin(new NextRequest("https://research.test", { headers: { "x-forwarded-proto": "javascript" } }))).toBeNull();
  });
});
