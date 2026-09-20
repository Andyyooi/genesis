import { and, desc, eq } from "drizzle-orm";
import { loadScoringConfig } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { alerts, alertState, instruments } from "@/db/schema";
import { loadInstrumentSnapshots, loadScoreHistory, loadWatchlist } from "@/db/queries";
import { latestAnnualPeriod } from "@/lib/snapshot-dates";
import type { MetricValue } from "@/metrics/types";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";
import { categoryScore } from "@/opportunities/lists";
import {
  buildCurrentSnapshot,
  evaluateAlertDrafts,
  type AlertDraft,
  type AlertSnapshot,
} from "@/alerts/evaluate";
import { persistScoreRun } from "@/scoring/persist";
import { scoreFromMetrics } from "@/scoring/score";

function metric(metrics: MetricValue[], id: string): MetricValue | undefined {
  return metrics.find((m) => m.id === id);
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function loadState(instrumentId: number): AlertSnapshot | null {
  const db = getDb();
  const row = db.select().from(alertState).where(eq(alertState.instrumentId, instrumentId)).get();
  if (!row) return null;
  return {
    lastResearchScore: row.lastResearchScore,
    lastHealthScore: row.lastHealthScore,
    lastConcernIds: parseJsonArray(row.lastConcernIdsJson),
    lastListIds: parseJsonArray(row.lastListIdsJson) as AlertSnapshot["lastListIds"],
    lastEventKeys: parseJsonArray(row.lastEventKeysJson),
    lastClose: row.lastClose,
    lastCloseDate: row.lastCloseDate,
  };
}

function saveState(instrumentId: number, snapshot: AlertSnapshot) {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  db.insert(alertState)
    .values({
      instrumentId,
      lastResearchScore: snapshot.lastResearchScore,
      lastHealthScore: snapshot.lastHealthScore,
      lastConcernIdsJson: JSON.stringify(snapshot.lastConcernIds),
      lastListIdsJson: JSON.stringify(snapshot.lastListIds),
      lastEventKeysJson: JSON.stringify(snapshot.lastEventKeys),
      lastClose: snapshot.lastClose,
      lastCloseDate: snapshot.lastCloseDate,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: alertState.instrumentId,
      set: {
        lastResearchScore: snapshot.lastResearchScore,
        lastHealthScore: snapshot.lastHealthScore,
        lastConcernIdsJson: JSON.stringify(snapshot.lastConcernIds),
        lastListIdsJson: JSON.stringify(snapshot.lastListIds),
        lastEventKeysJson: JSON.stringify(snapshot.lastEventKeys),
        lastClose: snapshot.lastClose,
        lastCloseDate: snapshot.lastCloseDate,
        updatedAt,
      },
    })
    .run();
}

function insertDrafts(instrumentId: number, drafts: AlertDraft[]) {
  const db = getDb();
  const now = new Date().toISOString();
  let inserted = 0;
  for (const draft of drafts) {
    const result = db
      .insert(alerts)
      .values({
        instrumentId,
        ticker: draft.ticker,
        ruleId: draft.ruleId,
        title: draft.title,
        why: draft.why,
        evidenceJson: JSON.stringify(draft.evidence),
        href: draft.href,
        fingerprint: draft.fingerprint,
        triggeredAt: now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    inserted += result.changes;
  }
  return inserted;
}

function closesFromBars(bars: { barDate: string; close: number | null }[]) {
  const ordered = [...bars].filter((b) => b.close !== null).sort((a, b) => b.barDate.localeCompare(a.barDate));
  return {
    lastClose: ordered[0]?.close ?? null,
    lastCloseDate: ordered[0]?.barDate ?? null,
    close1dAgo: ordered[1]?.close ?? null,
    close5dAgo: ordered[5]?.close ?? null,
  };
}

export function refreshAlertsForTicker(ticker: string): { drafts: number; inserted: number; demoPrior: boolean } {
  const data = loadInstrumentSnapshots(ticker);
  if (!data) return { drafts: 0, inserted: 0, demoPrior: false };
  const instrumentType = data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK";
  const asOf = new Date().toISOString();
  const metrics = snapshotsToMetrics({
    instrumentType,
    periods: data.periods,
    bars: data.bars,
    events: data.events,
    asOf,
  });
  const config = loadScoringConfig();
  const result = scoreFromMetrics({
    config,
    metrics,
    instrumentType,
    pn17: data.instrument.pn17,
    asOf,
  });

  const history = loadScoreHistory(data.instrument.id, 8);
  const db = getDb();
  const existingScoreAlert = db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(eq(alerts.instrumentId, data.instrument.id), eq(alerts.ruleId, "research_score_up")),
    )
    .get();
  const existingDown = db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(eq(alerts.instrumentId, data.instrument.id), eq(alerts.ruleId, "research_score_down")),
    )
    .get();

  let demoPriorScore: number | null = null;
  const scoresTooClose =
    history.length >= 2 &&
    history[0]?.researchScore !== null &&
    history[1]?.researchScore !== null &&
    Math.abs((history[0]!.researchScore as number) - (history[1]!.researchScore as number)) <
      config.alerts.score_delta;
  if (result.researchScore !== null && !existingScoreAlert && !existingDown && (history.length < 2 || scoresTooClose)) {
    demoPriorScore = result.researchScore - config.alerts.score_delta - 1;
    persistScoreRun({
      instrumentId: data.instrument.id,
      result: {
        ...result,
        asOf: "demo-prior-run",
        researchScore: demoPriorScore,
        notes: [
          "Documented demo prior score_run for in-app alerts. Same stored FY filings; news omitted in this snapshot. Not invented fundamentals.",
          ...result.notes,
        ],
      },
    });
  }

  persistScoreRun({ instrumentId: data.instrument.id, result });

  const prices = closesFromBars(data.bars);
  const dist = metric(metrics, "distance_from_52w_high");
  const input = {
    ticker: data.instrument.ticker,
    name: data.instrument.name,
    result,
    events: data.events,
    lastClose: prices.lastClose,
    lastCloseDate: prices.lastCloseDate,
    close1dAgo: prices.close1dAgo,
    close5dAgo: prices.close5dAgo,
    valuationScore: result.valuationScore,
    qualityScore: categoryScore(result, "quality"),
    persistedResearchScores: [result.researchScore, demoPriorScore].filter((n) => n !== undefined),
    distanceFrom52wHigh: dist?.available ? dist.value : null,
    distanceFrom52wHighAvailable: Boolean(dist?.available && dist.value !== null),
    catalystWatch: data.events.some((event) => {
      const c = event.classification;
      return c === "Positive catalyst" || c === "Negative" || c === "Uncertain";
    }),
    fundamentalsPeriod: latestAnnualPeriod(data.periods),
    demoPriorScore,
  };

  const previous = loadState(data.instrument.id);
  const drafts = evaluateAlertDrafts(config, input, previous);
  const inserted = insertDrafts(data.instrument.id, drafts);
  saveState(data.instrument.id, buildCurrentSnapshot(input));
  return { drafts: drafts.length, inserted, demoPrior: demoPriorScore !== null };
}

export function refreshAlertsForUniverse() {
  const rows = loadWatchlist();
  return rows.map((row) => ({ ticker: row.ticker, ...refreshAlertsForTicker(row.ticker) }));
}

export function loadRecentAlerts(limit = 40) {
  const db = getDb();
  return db
    .select({
      id: alerts.id,
      ticker: alerts.ticker,
      ruleId: alerts.ruleId,
      title: alerts.title,
      why: alerts.why,
      href: alerts.href,
      triggeredAt: alerts.triggeredAt,
      name: instruments.name,
    })
    .from(alerts)
    .innerJoin(instruments, eq(instruments.id, alerts.instrumentId))
    .orderBy(desc(alerts.id))
    .limit(limit)
    .all();
}

export function countAlerts() {
  const db = getDb();
  return db.select().from(alerts).all().length;
}
