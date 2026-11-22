/**
 * Point-in-time backtest of the Buy score: on each month-end, rebuild research
 * scores and fair ranges from only the data available that day, then check what
 * the price did 3, 6 and 12 months later. Read-only: run on a copy of the snapshot.
 *
 *   BURSA_SQLITE_PATH=/path/to/copy.db npx tsx scripts/backtest-buy-score.ts
 */
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { financialPeriods, instruments, priceBars } from "@/db/schema";
import { calculateFairValue } from "@/fair-value/orchestrate";
import { assessFairValueQuality } from "@/fair-value/quality";
import { buyScore } from "@/lib/buy-score";
import { fairRangeHeadline } from "@/lib/fair-range";
import { usableAccounts } from "@/metrics/evidence";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { scoreUniverse, type ScoreInput } from "@/scoring/score";
import type { PeerUniverseRow } from "@/scoring/peer-group";
import { periodsToSnapshots } from "@/scoring/valuation-context";

const HORIZONS = [3, 6, 12] as const;
const START = process.env.BACKTEST_START ?? "2025-07-31";

type Bar = typeof priceBars.$inferSelect;
type Period = typeof financialPeriods.$inferSelect;

function monthEnds(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (d.toISOString().slice(0, 10) <= to) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 2);
    d.setUTCDate(0);
  }
  return out;
}

function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function main() {
  const config = loadScoringConfig();
  const db = getDb();
  const listed = db.select().from(instruments).all().filter((row) => row.listingStatus !== "inactive");
  const periodsBy = new Map<number, Period[]>();
  for (const row of db.select().from(financialPeriods).all()) {
    const list = periodsBy.get(row.instrumentId) ?? [];
    list.push(row);
    periodsBy.set(row.instrumentId, list);
  }
  const barsBy = new Map<number, Bar[]>();
  for (const row of db.select().from(priceBars).all()) {
    const list = barsBy.get(row.instrumentId) ?? [];
    list.push(row);
    barsBy.set(row.instrumentId, list);
  }
  for (const list of barsBy.values()) list.sort((a, b) => b.barDate.localeCompare(a.barDate));
  const lastBarDay = [...barsBy.values()].reduce((max, list) => (list[0] && list[0].barDate > max ? list[0].barDate : max), "");

  /** Last close on or before a day, with its dividend/split-adjusted close when stored. */
  const closeOn = (id: number, day: string) => {
    const bar = (barsBy.get(id) ?? []).find((b) => b.barDate <= day && b.close != null && b.close > 0);
    if (!bar) return null;
    return { day: bar.barDate, price: bar.close!, adjusted: bar.adjClose != null && bar.adjClose > 0 ? bar.adjClose : null };
  };

  const samples: Record<string, unknown>[] = [];
  const dates = monthEnds(START, addMonths(lastBarDay, -4));
  for (const day of dates) {
    const asOf = `${day}T23:59:59.000Z`;
    const prepared = listed.map((instrument) => {
      const bars = (barsBy.get(instrument.id) ?? []).filter((bar) => bar.barDate <= day);
      const periods = usableAccounts(periodsBy.get(instrument.id) ?? [], asOf, config.reporting_lag_months);
      const instrumentType = instrument.instrumentType === "REIT" ? "REIT" as const : "COMMON_STOCK" as const;
      const profile = resolveResearchProfile(instrumentType, instrument.ticker, { sector: instrument.sector, industry: instrument.industry }, config).profile;
      const metrics = snapshotsToMetrics({ periods, bars, instrumentType, ticker: instrument.ticker, sector: instrument.sector, industry: instrument.industry, events: [], asOf, config });
      const latest = periods.filter((p) => p.statementType === "annual").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
      const input: ScoreInput = { config, metrics, instrumentType, ticker: instrument.ticker, sector: instrument.sector, industry: instrument.industry, researchProfile: profile, pn17: instrument.pn17, warning: instrument.warningFlag, bars, asOf, latestAnnual: latest ?? null };
      const snapshots = periodsToSnapshots(periods);
      return { instrument, profile, bars, snapshots, input };
    });
    const results = scoreUniverse(prepared.map((p) => p.input));
    const peers: PeerUniverseRow[] = prepared.map(({ instrument, profile, bars, snapshots }) => {
      const annual = snapshots.filter((s) => s.statementType === "annual").sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
      const close = bars.find((b) => b.close != null);
      return {
        ticker: instrument.ticker, name: instrument.name, listingStatus: instrument.listingStatus, instrumentType: instrument.instrumentType,
        researchProfile: profile, industry: instrument.industry, sector: instrument.sector,
        lastClose: close?.close ?? null, lastCloseDate: close?.barDate ?? null,
        periodEnd: annual?.periodEnd ?? null, availableAt: annual?.availableAt ?? null,
        eps: annual?.eps ?? null, dividendPerShare: annual?.dividendPerShare ?? null, equity: annual?.equity ?? null,
        shares: annual?.shares ?? null, revenue: annual?.revenue ?? null, pat: annual?.pat ?? null,
      };
    });
    const allScores = [...results.values()].map((r) => r.researchScore).filter((s): s is number => s !== null && Number.isFinite(s));
    for (const { instrument, profile, bars, snapshots } of prepared) {
      const result = results.get(instrument.ticker);
      if (!result || result.researchScore === null) continue;
      const entry = closeOn(instrument.id, day);
      if (!entry || entry.day < addMonths(day, -1)) continue;
      const fv = calculateFairValue({ ticker: instrument.ticker, researchProfile: profile, industry: instrument.industry, sector: instrument.sector, periods: snapshots, bars: bars.map((b) => ({ barDate: b.barDate, close: b.close, high: b.high, low: b.low })), peers, asOf });
      const quality = assessFairValueQuality(fv, snapshots.filter((s) => s.statementType === "annual").map((s) => ({ periodEnd: s.periodEnd, eps: s.eps, pat: s.pat, shares: s.shares, dividendPerShare: s.dividendPerShare })));
      const range = fairRangeHeadline({ ok: true, run: { id: 0, instrumentId: instrument.id, calculatedAt: asOf, observationKey: "", qualityVersion: "", result: fv, quality } }, entry.price);
      const caution = result.dataConfidence.needsVerification || result.eligibility?.eligible !== true;
      const buy = buyScore({
        researchScore: result.researchScore,
        allResearchScores: allScores,
        eligible: result.eligibility?.eligible === true,
        needsVerification: result.dataConfidence.needsVerification,
      });
      const returns: Record<string, number | null> = {};
      for (const months of HORIZONS) {
        const exitDay = addMonths(day, months);
        const exit = exitDay <= lastBarDay ? closeOn(instrument.id, exitDay) : null;
        // A stock that stopped trading has no result for this horizon rather than an older close.
        const fresh = exit && exit.day > addMonths(day, months - 1);
        const bothAdjusted = exit?.adjusted != null && entry.adjusted != null;
        returns[`r${months}`] = exit && fresh
          ? bothAdjusted ? exit.adjusted! / entry.adjusted! - 1 : exit.price / entry.price - 1
          : null;
      }
      samples.push({
        day, ticker: instrument.ticker, research: result.researchScore, eligible: result.eligibility?.eligible === true, caution,
        position: range.available ? range.position : null,
        buy: buy.available ? buy.score : null,
        ...returns,
      });
    }
    console.error(`${day}: ${samples.length} samples so far`);
  }
  console.log(JSON.stringify({ lastBarDay, dates, samples }));
}

main();
