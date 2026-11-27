import { createHash, timingSafeEqual } from "node:crypto";

export const EXPORT_PATH = "/api/export";
export const EXPORT_CACHE_CONTROL = "private, no-store";

export function exportAuthError(request: Request): Response | null {
  const expected = process.env.EXPORT_API_TOKEN;
  const headers = { "Cache-Control": EXPORT_CACHE_CONTROL };
  if (!expected?.trim()) {
    return Response.json({ error: "The research export is not configured." }, { status: 503, headers });
  }

  const provided = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (provided) {
    const digest = (token: string) => createHash("sha256").update(token).digest();
    if (timingSafeEqual(digest(provided), digest(expected))) return null;
  }
  return Response.json({ error: "A valid export token is required." }, {
    status: 401,
    headers: { ...headers, "WWW-Authenticate": 'Bearer realm="genesis-export"' },
  });
}
