import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { alerts, alertState, scoreRuns } from "@/db/schema";

export function isDemoAlert(raw: string | null): boolean {
  try { return JSON.parse(raw ?? "{}").demo === true; } catch { return false; }
}

export function purgeDemoAlerts() {
  const db = getDb();
  for (const row of db.select().from(alerts).all().filter((row) => isDemoAlert(row.evidenceJson))) {
    db.delete(alerts).where(eq(alerts.id, row.id)).run();
    db.delete(alertState).where(eq(alertState.instrumentId, row.instrumentId)).run();
  }
  db.delete(scoreRuns).where(eq(scoreRuns.asOf, "demo-prior-run")).run();
}
