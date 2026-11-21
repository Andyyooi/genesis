import type { NextRequest } from "next/server";

export function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (!host || /[\s/\\,@?#]/.test(host) || !["http", "https"].includes(protocol)) return null;
  try { return new URL(`${protocol}://${host}`).origin; } catch { return null; }
}

export function isSameOrigin(request: NextRequest): boolean {
  const expected = requestOrigin(request);
  return expected !== null && request.headers.get("origin") === expected;
}
