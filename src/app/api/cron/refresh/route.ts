import { NextRequest, NextResponse } from "next/server";
import { constantTimePasswordEqual } from "@/auth/session";
import { deployedSnapshotState } from "@/refresh/deployed-snapshot";
import { dispatchRefresh, isPublishedAfterMalaysiaEveningCutoff } from "@/refresh/github";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Scheduled refresh isn't set up yet (missing CRON_SECRET)." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !(await constantTimePasswordEqual(token, cronSecret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const snapshot = deployedSnapshotState();
  if (isPublishedAfterMalaysiaEveningCutoff(snapshot.publishedAt)) {
    return NextResponse.json(
      { skipped: true, reason: "already_published_today", ...snapshot },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result = await dispatchRefresh(snapshot, { source: "scheduled" });
    if (result.status === 409) {
      return NextResponse.json(
        { skipped: true, reason: "already_running", ...result.body },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "GitHub refresh request failed. Check the token, workflow and repository permissions, then check Actions before retrying." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
