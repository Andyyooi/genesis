import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, requestOrigin } from "@/auth/origin";
import { SESSION_COOKIE, sessionCookieOptions } from "@/auth/session";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const response = NextResponse.redirect(new URL("/login", requestOrigin(request)!), 303);
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(process.env), maxAge: 0 });
  return response;
}
