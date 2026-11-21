import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, requestOrigin } from "@/auth/origin";
import { loginAttemptLimiter } from "@/auth/login-attempts";
import { constantTimePasswordEqual, protectionMode, sanitizeNextPath, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/auth/session";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const mode = protectionMode(process.env);
  if (mode === "unconfigured") return NextResponse.json({ error: "The site password isn't configured." }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const next = sanitizeNextPath(form.get("next"));
  if (mode === "disabled") return NextResponse.redirect(new URL(next, requestOrigin(request)!), 303);
  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 128);
  const attempt = loginAttemptLimiter.begin(ip);
  if (!attempt.allowed) {
    const query = new URLSearchParams({ next, error: "rate_limit" }).toString().replaceAll("&", "&amp;");
    return new NextResponse(`<!doctype html><html lang="en"><head><title>Genesis Research</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;margin:15vh auto;padding:24px;max-width:28rem"><main><h1>Genesis Research</h1><p role="alert">Too many failed sign-in attempts. Please wait up to 15 minutes before trying again.</p><a href="/login?${query}">Return to sign in</a></main></body></html>`, { status: 429, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(attempt.retryAfter), "Cache-Control": "no-store" } });
  }
  const password = form.get("password");
  let matches = false;
  try { matches = typeof password === "string" && password.length <= 4096 && await constantTimePasswordEqual(password, process.env.SITE_PASSWORD!); }
  finally { attempt.finish(matches); }
  if (!matches) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const login = new URL("/login", requestOrigin(request)!);
    login.searchParams.set("next", next);
    login.searchParams.set("error", "1");
    return NextResponse.redirect(login, 303);
  }
  const response = NextResponse.redirect(new URL(next, requestOrigin(request)!), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, await signSession(process.env), sessionCookieOptions(process.env));
  return response;
}
