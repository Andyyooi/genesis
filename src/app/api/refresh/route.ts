import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/auth/origin";
import { deployedSnapshotState } from "@/refresh/deployed-snapshot";
import { dispatchRefresh } from "@/refresh/github";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const result = await dispatchRefresh(deployedSnapshotState());
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "GitHub refresh request failed. Check the token, workflow and repository permissions, then check Actions before retrying." }, { status: 502 });
  }
}
