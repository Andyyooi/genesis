import { getSqlite } from "@/db/client";
import type { SnapshotState } from "@/refresh/github";

export function deployedSnapshotState(): SnapshotState {
  const sqlite = getSqlite();
  const prices = sqlite.prepare("SELECT MAX(bar_date) AS date FROM price_bars").get() as { date: string | null };
  const run = sqlite.prepare("SELECT as_of FROM market_scan_runs ORDER BY id DESC LIMIT 1").get() as { as_of: string } | undefined;
  return { latestPriceDate: prices.date ?? run?.as_of.slice(0, 10) ?? null, publishedAt: run?.as_of ?? null };
}
