import { NextResponse } from "next/server";
import { deployedSnapshotState } from "@/refresh/deployed-snapshot";
import { getRefreshStatus } from "@/refresh/github";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getRefreshStatus(deployedSnapshotState()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Cannot read GitHub refresh status. Check the token, workflow and repository permissions." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
