import { getSqlite } from "@/db/client";
import { loadFairValueRunById } from "@/fair-value/load-run";

export function loadPersistedFairValueForPage(instrumentId: number) {
  const sqlite = getSqlite();
  const row = sqlite.prepare("SELECT id FROM fair_value_runs WHERE instrument_id = ? ORDER BY id DESC LIMIT 1").get(instrumentId) as { id: number } | undefined;
  return row ? loadFairValueRunById(sqlite, row.id) : null;
}
