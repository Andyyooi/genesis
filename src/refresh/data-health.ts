import { statSync } from "node:fs";
import type Database from "better-sqlite3";
import { getSqlite } from "@/db/client";
import { servedSnapshotPath } from "@/db/snapshot-file";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import { OLD_NEWEST_PRICE_DAYS } from "@/refresh/price-check";
import { malaysiaMarketDate } from "@/refresh/types";

const MIN_COVERAGE_PERCENT = 90;
const BURSA_CLOSE_UTC = "+9 hours"; // 17:00 Malaysia time.

export function readPriceHealth(sqlite: Database.Database, today: string) {
  const instruments = sqlite.prepare("SELECT id FROM instruments WHERE listing_status = 'listed'").all() as { id: number }[];
  const recent = sqlite.prepare(`
    SELECT bar_date AS date FROM price_bars
    WHERE instrument_id = ? AND bar_date <= ? AND source = 'yahoo'
      AND close > 0 AND close <= 1.7976931348623157e308 AND date(bar_date, '+0 days') = bar_date
      AND datetime(retrieved_at) >= datetime(bar_date, ?)
    ORDER BY bar_date DESC LIMIT 2
  `);
  const datesByInstrument = instruments.map(({ id }) =>
    (recent.all(id, today, BURSA_CLOSE_UTC) as { date: string }[]).map(({ date }) => date));
  const [asOfDate = null, previousPriceDate = null] = [...new Set(datesByInstrument.flat())].sort().reverse();
  const freshPriceCount = asOfDate && previousPriceDate
    ? datesByInstrument.filter(([latest, previous]) => latest === asOfDate && previous === previousPriceDate).length
    : 0;
  const listedCount = instruments.length;
  const ageDays = asOfDate === null ? null : (Date.parse(today) - Date.parse(asOfDate)) / 86400000;

  return {
    asOfDate,
    previousPriceDate,
    freshPriceCount,
    listedCount,
    ageDays,
    stale: ageDays === null || ageDays > OLD_NEWEST_PRICE_DAYS,
    lowCoverage: listedCount === 0 || freshPriceCount * 100 < MIN_COVERAGE_PERCENT * listedCount,
  };
}

export type DataHealth = ReturnType<typeof readPriceHealth> & {
  status: "ok" | "degraded";
  snapshotBytes: number | null;
};

let cachedSnapshotHealth: { today: string; health: DataHealth } | undefined;

export function loadDataHealth(now = new Date()): DataHealth | null {
  const today = malaysiaMarketDate(now);
  const readOnly = isSnapshotReadOnly();
  if (readOnly && cachedSnapshotHealth?.today === today) return cachedSnapshotHealth.health;
  try {
    const prices = readPriceHealth(getSqlite(), today);
    const path = readOnly ? servedSnapshotPath() : null;
    const health: DataHealth = {
      ...prices,
      status: prices.stale || prices.lowCoverage ? "degraded" : "ok",
      snapshotBytes: path ? statSync(/*turbopackIgnore: true*/ path).size : null,
    };
    if (readOnly) cachedSnapshotHealth = { today, health };
    return health;
  } catch {
    return null;
  }
}
