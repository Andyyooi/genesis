import { getSqlite } from "@/db/client";
import { loadLatestDatasetRefresh, persistDatasetRefresh } from "@/refresh/persist";
import type { DatasetRefreshResult } from "@/refresh/types";

/** Bursa's daily price limit is 30%; one or two price ticks on penny stocks are ignored. */
export const PRICE_JUMP_PERCENT = 30;
export const PRICE_JUMP_MIN_RM = 0.05;
export const RECENT_MARKET_DAYS = 5;
export const OLD_NEWEST_PRICE_DAYS = 4;

export type PriceCheckBar = { date: string; close: number | null };
export type PriceCheckInput = { ticker: string; name: string; latestDate: string | null; bars: PriceCheckBar[] };
export type PriceCheckStock = { ticker: string; name: string };
export type PriceCheckReport = {
  kind: "price-check";
  checkedAt: string;
  marketDate: string | null;
  newestDate: string | null;
  newestDaysOld: number | null;
  listed: number;
  noPrice: PriceCheckStock[];
  stale: (PriceCheckStock & { lastDate: string })[];
  jumps: (PriceCheckStock & { date: string; from: number; to: number; changePercent: number })[];
  failedThisRun: string[];
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const roundPrice = (value: number) => Math.round(value * 10000) / 10000;
const usable = (close: number | null): close is number => typeof close === "number" && Number.isFinite(close) && close > 0;

/** Flags missing, stale and implausibly moving saved prices. Never changes the prices themselves. */
export function findPriceIssues(
  stocks: PriceCheckInput[],
  options: { checkedAt: string; marketDate?: string | null; failedThisRun?: string[] },
): PriceCheckReport {
  const newestDate = stocks.flatMap((s) => (s.latestDate ? [s.latestDate] : [])).sort().at(-1) ?? null;
  const recentDates = [...new Set(stocks.flatMap((s) => s.bars.map((b) => b.date)))].sort().slice(-RECENT_MARKET_DAYS);
  const windowStart = recentDates[0] ?? null;
  const report: PriceCheckReport = {
    kind: "price-check",
    checkedAt: options.checkedAt,
    marketDate: options.marketDate ?? null,
    newestDate,
    newestDaysOld: newestDate && options.marketDate ? daysBetween(newestDate, options.marketDate) : null,
    listed: stocks.length,
    noPrice: [],
    stale: [],
    jumps: [],
    failedThisRun: [...new Set(options.failedThisRun ?? [])].sort(),
  };
  for (const stock of stocks) {
    const who = { ticker: stock.ticker, name: stock.name };
    if (!stock.latestDate) {
      report.noPrice.push(who);
      continue;
    }
    if (newestDate && stock.latestDate < newestDate) report.stale.push({ ...who, lastDate: stock.latestDate });
    const bars = [...stock.bars].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = bars.length - 1; i > 0; i--) {
      const current = bars[i]!;
      const previous = bars[i - 1]!;
      if (!windowStart || current.date < windowStart) break;
      if (!usable(current.close) || !usable(previous.close)) continue;
      const change = current.close / previous.close - 1;
      if (Math.abs(change) * 100 >= PRICE_JUMP_PERCENT && Math.abs(current.close - previous.close) >= PRICE_JUMP_MIN_RM) {
        report.jumps.push({ ...who, date: current.date, from: roundPrice(previous.close), to: roundPrice(current.close), changePercent: Math.round(change * 1000) / 10 });
        break;
      }
    }
  }
  report.stale.sort((a, b) => a.lastDate.localeCompare(b.lastDate) || a.ticker.localeCompare(b.ticker));
  report.jumps.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  return report;
}

export function priceCheckIssueCount(report: PriceCheckReport): number {
  const flagged = new Set([...report.noPrice, ...report.stale, ...report.jumps].map((s) => s.ticker));
  for (const ticker of report.failedThisRun) flagged.add(ticker);
  return flagged.size;
}

export function priceNewestTooOld(report: PriceCheckReport): boolean {
  return report.newestDaysOld !== null && report.newestDaysOld > OLD_NEWEST_PRICE_DAYS;
}

/** Read-only: recent saved Yahoo closes for every listed stock. */
export function loadPriceCheckInputs(): PriceCheckInput[] {
  const sqlite = getSqlite();
  const latest = sqlite
    .prepare(
      `SELECT i.id, i.ticker, i.name,
        (SELECT MAX(p.bar_date) FROM price_bars p WHERE p.instrument_id = i.id AND p.source = 'yahoo') AS latestDate
       FROM instruments i WHERE i.listing_status = 'listed' ORDER BY i.ticker`,
    )
    .all() as { id: number; ticker: string; name: string; latestDate: string | null }[];
  const newest = latest.flatMap((row) => (row.latestDate ? [row.latestDate] : [])).sort().at(-1);
  const byId = new Map<number, PriceCheckBar[]>();
  if (newest) {
    const bars = sqlite
      .prepare(
        `SELECT instrument_id AS id, bar_date AS date, close FROM price_bars
         WHERE source = 'yahoo' AND bar_date >= date(?, '-30 days') ORDER BY instrument_id, bar_date`,
      )
      .all(newest) as { id: number; date: string; close: number | null }[];
    for (const bar of bars) {
      const list = byId.get(bar.id) ?? [];
      list.push({ date: bar.date, close: bar.close });
      byId.set(bar.id, list);
    }
  }
  return latest.map((row) => ({
    ticker: row.ticker,
    name: row.name,
    latestDate: row.latestDate,
    bars: (byId.get(row.id) ?? []).slice(-(RECENT_MARKET_DAYS + 1)),
  }));
}

export function priceCheckSummary(report: PriceCheckReport): string | null {
  const parts = [
    priceNewestTooOld(report) ? `newest price is ${report.newestDaysOld} days old` : null,
    report.failedThisRun.length ? `${report.failedThisRun.length} not downloaded this refresh` : null,
    report.noPrice.length ? `${report.noPrice.length} with no saved price` : null,
    report.stale.length ? `${report.stale.length} with an older last price` : null,
    report.jumps.length ? `${report.jumps.length} with a jump of ${PRICE_JUMP_PERCENT}% or more` : null,
  ].filter(Boolean);
  return parts.length ? `Price check: ${parts.join("; ")}.` : null;
}

/** Runs in the daily refresh right after prices are downloaded and stores its findings. */
export function runPriceCheck(
  runId: string,
  marketDate: string,
  options: { now?: () => Date; failedThisRun?: string[] } = {},
): DatasetRefreshResult {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const report = findPriceIssues(loadPriceCheckInputs(), { checkedAt: startedAt, marketDate, failedThisRun: options.failedThisRun });
  const flagged = priceCheckIssueCount(report);
  const summary = priceCheckSummary(report);
  return persistDatasetRefresh(runId, {
    dataset: "price_check",
    source: "saved-prices",
    status: report.listed === 0 ? "NO_DATA" : summary ? "PARTIAL" : "SUCCESS",
    startedAt,
    completedAt: now().toISOString(),
    marketDate,
    attemptedCount: report.listed,
    updatedCount: 0,
    unchangedCount: report.listed - flagged,
    failedCount: 0,
    unavailableCount: flagged,
    lastSuccessfulAt: null,
    errorSummary: summary,
    metadata: report,
  });
}

/** The check stored by the latest refresh; re-checked read-only when it does not match the published prices. */
export function loadPriceCheck(): { report: PriceCheckReport; fromRefresh: boolean } {
  const inputs = loadPriceCheckInputs();
  const stored = loadLatestDatasetRefresh("price_check")?.metadata as PriceCheckReport | undefined;
  const live = findPriceIssues(inputs, { checkedAt: new Date().toISOString() });
  if (stored?.kind === "price-check" && stored.newestDate === live.newestDate && stored.listed === live.listed) {
    return { report: stored, fromRefresh: true };
  }
  return { report: live, fromRefresh: false };
}
