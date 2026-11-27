import type { YahooBar } from "@/ingest/providers/yahoo-prices";

const BAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC midnight for a real calendar date from 1990 onward. Unusable strings return null. */
export function yahooBarDateUtc(barDate: string): number | null {
  const match = BAR_DATE.exec(barDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    year < 1990
  ) {
    return null;
  }
  return utc;
}

/** A daily bar Genesis can store. Rejects empty, non-numeric, non-positive, and unusable dates. */
export function usableYahooDailyBar(bar: YahooBar, now = new Date()): boolean {
  if (typeof bar.close !== "number" || !Number.isFinite(bar.close) || bar.close <= 0) return false;
  for (const value of [bar.open, bar.high, bar.low, bar.adjClose]) {
    if (value == null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  }
  if (bar.volume != null && (typeof bar.volume !== "number" || !Number.isFinite(bar.volume) || bar.volume < 0)) {
    return false;
  }
  const utc = yahooBarDateUtc(bar.barDate);
  if (utc == null) return false;
  const ceiling = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return utc <= ceiling;
}

/** Bursa's session ends at 5:00 PM; Yahoo's final close is trusted only after this Malaysia time. */
export const BURSA_CLOSE_SETTLED_MINUTES = 17 * 60 + 30;
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's Malaysia date while Bursa's session has not settled, otherwise null. A bar for this date is not a close yet. */
export function inProgressSessionDate(now = new Date()): string | null {
  const malaysia = new Date(now.getTime() + MALAYSIA_OFFSET_MS);
  const minutes = malaysia.getUTCHours() * 60 + malaysia.getUTCMinutes();
  return minutes < BURSA_CLOSE_SETTLED_MINUTES ? malaysia.toISOString().slice(0, 10) : null;
}
