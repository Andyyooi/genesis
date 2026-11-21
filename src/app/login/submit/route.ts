import { NextRequest, NextResponse } from "next/server";
import { constantTimePasswordEqual, protectionMode, sanitizeNextPath, SESSION_COOKIE, sessionCookieOptions, signSession } from "@/auth/session";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
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
  if (mode === "disabled") return NextResponse.redirect(new URL(next, request.url), 303);
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 4096 || !(await constantTimePasswordEqual(password, process.env.SITE_PASSWORD!))) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const login = new URL("/login", request.url);
    login.searchParams.set("next", next);
    login.searchParams.set("error", "1");
    return NextResponse.redirect(login, 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(SESSION_COOKIE, await signSession(process.env), sessionCookieOptions(process.env));
  return response;
}
