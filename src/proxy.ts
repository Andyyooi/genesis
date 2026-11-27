import { NextRequest, NextResponse } from "next/server";
import { EXPORT_CACHE_CONTROL, EXPORT_PATH, exportAuthError } from "@/auth/export-token";
import { requestOrigin } from "@/auth/origin";
import { gateDecision, sanitizeNextPath, SESSION_COOKIE } from "@/auth/session";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === EXPORT_PATH && request.method === "GET") {
    return exportAuthError(request) ?? NextResponse.next({ headers: { "Cache-Control": EXPORT_CACHE_CONTROL } });
  }
  const decision = await gateDecision(request.nextUrl.pathname, request.method, request.cookies.get(SESSION_COOKIE)?.value, process.env);
  if (decision === "allow") {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (decision === "unconfigured") {
    if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "The site password isn't configured." }, { status: 503 });
    }
    return new NextResponse("<!doctype html><html lang=\"en\"><head><title>Genesis Research</title></head><body><main><h1>Genesis Research</h1><p>The site password isn't configured. Contact the site administrator.</p></main></body></html>", {
      status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (decision === "unauthorized") return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const login = new URL("/login", requestOrigin(request) ?? request.nextUrl.origin);
  login.searchParams.set("next", sanitizeNextPath(request.nextUrl.pathname + request.nextUrl.search));
  return NextResponse.redirect(login, 303);
}
