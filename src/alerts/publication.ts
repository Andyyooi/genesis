import { getSqlite } from "@/db/client";
import { loadFairValueRunById } from "@/fair-value/load-run";
import type { AlertDraft } from "@/alerts/evaluate";
import { loadScoringConfig, type ScoringConfig } from "@/config/load-scoring";

type PublicationAlertPolicy = ScoringConfig["alerts"]["publication"];

export const PUBLICATION_ALERT_METHOD = "universe-publication-v1";

export type AlertCompany = {
  instrumentId: number;
  ticker: string;
  researchScore: number | null;
  eligible: boolean;
  exclusionReasons: string[];
  lastTrade: string | null;
  fairValueSafety: string | null;
};

export type AlertPublication = { id: number; asOf: string; priceDate: string | null; rows: AlertCompany[] };

export type PublicationAlertSummary = {
  method: typeof PUBLICATION_ALERT_METHOD;
  previousRunDate: string | null;
  priceDate: string | null;
  count: number;
};

export function fairValueSafetyAt(instrumentId: number, asOf: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite.prepare("SELECT id FROM fair_value_runs WHERE instrument_id = ? AND calculated_at <= ? ORDER BY id DESC LIMIT 1").get(instrumentId, asOf) as { id: number } | undefined;
  if (!row) return null;
  const stored = loadFairValueRunById(sqlite, row.id);
  return stored?.ok ? stored.run.quality.status : null;
}

export function loadAlertPublication(): AlertPublication | null {
  const sqlite = getSqlite();
  const run = sqlite.prepare("SELECT id, as_of AS asOf, summary_json AS summary FROM market_scan_runs ORDER BY id DESC LIMIT 1").get() as { id: number; asOf: string; summary: string } | undefined;
  if (!run || JSON.parse(run.summary).methodology !== "cross-sectional-v2") return null;
  const stored = sqlite.prepare("SELECT instrument_id AS instrumentId, payload_json AS payload FROM market_scan_rows WHERE run_id = ?").all(run.id) as { instrumentId: number; payload: string }[];
  const rows = stored.map((row): AlertCompany => {
    const payload = JSON.parse(row.payload);
    return {
      instrumentId: row.instrumentId,
      ticker: payload.ticker,
      researchScore: payload.researchScore,
      eligible: payload.eligible === true,
      exclusionReasons: payload.exclusionReasons ?? [],
      lastTrade: payload.lastTrade ?? null,
      fairValueSafety: "fairValueSafety" in payload ? payload.fairValueSafety : fairValueSafetyAt(row.instrumentId, run.asOf),
    };
  });
  const priceDate = rows.flatMap((row) => row.lastTrade ? [row.lastTrade] : []).sort().at(-1) ?? null;
  return { id: run.id, asOf: run.asOf, priceDate, rows };
}

function topPicks(rows: AlertCompany[]) {
  return new Set(rows.filter((row) => row.eligible && row.researchScore !== null && Number.isFinite(row.researchScore))
    .sort((a, b) => b.researchScore! - a.researchScore! || a.ticker.localeCompare(b.ticker)).slice(0, 15).map((row) => row.ticker));
}

function exclusionKey(reason: string) {
  if (/PN17|warning/i.test(reason)) return "warning";
  if (/traded value|liquidity|volume/i.test(reason)) return "liquidity";
  if (/price days/i.test(reason)) return "price_history";
  if (/coverage/i.test(reason)) return "coverage";
  return reason;
}

export function evaluatePublicationAlerts(previous: AlertPublication | null, current: AlertPublication, threshold: number, policy: PublicationAlertPolicy = loadScoringConfig().alerts.publication): AlertDraft[] {
  if (!previous) return [];
  const drafts: AlertDraft[] = [];
  const old = new Map(previous.rows.map((row) => [row.ticker, row]));
  const now = new Map(current.rows.map((row) => [row.ticker, row]));
  const priorPicks = topPicks(previous.rows);
  const currentPicks = topPicks(current.rows);
  const comparison = `Comparison: previous run ${previous.asOf.slice(0, 10)} → this run's price date ${current.priceDate ?? "unavailable"} (published ${current.asOf}). Research only, not a buy/sell instruction.`;
  for (const ticker of new Set([...old.keys(), ...now.keys()])) {
    const before = old.get(ticker);
    const after = now.get(ticker);
    const isPick = priorPicks.has(ticker) || currentPicks.has(ticker);
    const add = (ruleId: string, title: string, why: string, evidence: Record<string, unknown>) => drafts.push({
      ruleId, ticker, title, why: `${why} ${comparison}`,
      evidence: { ...evidence, method: PUBLICATION_ALERT_METHOD, previousRunId: previous.id, publicationRunId: current.id, previousRunDate: previous.asOf.slice(0, 10), priceDate: current.priceDate, publishedAt: current.asOf },
      fingerprint: `${previous.id}->${current.id}`,
      href: `/stock/${encodeURIComponent(ticker)}`,
    });
    if (before && after) {
      const from = before.researchScore;
      const to = after.researchScore;
      if ((!policy.score_eligible_only || after.eligible || isPick) && from !== null && to !== null && Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) >= threshold && to !== from) {
        add(to > from ? "research_score_up" : "research_score_down", `${ticker} Research Score ${from.toFixed(1)} → ${to.toFixed(1)}`,
          `Published Research Score moved ${from.toFixed(1)} → ${to.toFixed(1)} (threshold ${threshold} points).`, { from, to, threshold });
      }
      const priorReasons = new Set(before.exclusionReasons.map(exclusionKey));
      const reasons = after.exclusionReasons.filter((reason) => !priorReasons.has(exclusionKey(reason)) && (!policy.exclusions_top_picks_only || isPick || policy.important_exclusions.includes(exclusionKey(reason))));
      if (reasons.length) add("new_exclusion_reason", `${ticker} new recommendation exclusion`, reasons.join(" "), { reasons, important: reasons.some((reason) => policy.important_exclusions.includes(exclusionKey(reason))) });
      if (before.fairValueSafety !== null && after.fairValueSafety !== null && before.fairValueSafety !== after.fairValueSafety) {
        add("fair_value_safety_changed", `${ticker} fair-value safety ${before.fairValueSafety} → ${after.fairValueSafety}`,
          `Persisted fair-value safety changed from ${before.fairValueSafety} to ${after.fairValueSafety}. Open the company page for the assessment.`, { from: before.fairValueSafety, to: after.fairValueSafety });
      }
    }
    if (priorPicks.has(ticker) !== currentPicks.has(ticker)) {
      const entered = currentPicks.has(ticker);
      add(entered ? "top_pick_entered" : "top_pick_left", `${ticker} ${entered ? "entered" : "left"} the top picks`,
        `${ticker} ${entered ? "is now" : "is no longer"} among the 15 highest-scoring eligible names in the published universe.`, { from: priorPicks.has(ticker), to: entered });
    }
  }
  const priority = (draft: AlertDraft) => {
    const index = policy.priority.indexOf(draft.ruleId);
    return index < 0 ? policy.priority.length : index;
  };
  const magnitude = (draft: AlertDraft) => Math.abs(Number(draft.evidence.to) - Number(draft.evidence.from)) || 0;
  drafts.sort((a, b) => priority(a) - priority(b)
    || Number(b.evidence.important === true) - Number(a.evidence.important === true)
    || magnitude(b) - magnitude(a) || a.ticker.localeCompare(b.ticker));
  const counts = new Map<string, number>();
  return drafts.filter((draft) => {
    const count = counts.get(draft.ruleId) ?? 0;
    if (count >= (policy.max_per_type[draft.ruleId] ?? 0)) return false;
    counts.set(draft.ruleId, count + 1);
    return true;
  });
}

/** Called inside the universe publication transaction; retain only this refresh's changes. */
export function replacePublicationAlerts(previous: AlertPublication | null, current: AlertPublication, threshold: number, policy?: PublicationAlertPolicy): PublicationAlertSummary {
  const sqlite = getSqlite();
  const drafts = evaluatePublicationAlerts(previous, current, threshold, policy);
  sqlite.prepare("DELETE FROM alerts").run();
  const companies = new Map([...(previous?.rows ?? []), ...current.rows].map((row) => [row.ticker, row]));
  const insert = sqlite.prepare("INSERT INTO alerts (instrument_id, ticker, rule_id, title, why, evidence_json, href, fingerprint, triggered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const draft of [...drafts].reverse()) insert.run(companies.get(draft.ticker)!.instrumentId, draft.ticker, draft.ruleId, draft.title, draft.why, JSON.stringify(draft.evidence), draft.href, draft.fingerprint, current.asOf, current.asOf);
  return { method: PUBLICATION_ALERT_METHOD, previousRunDate: previous?.asOf.slice(0, 10) ?? null, priceDate: current.priceDate, count: drafts.length };
}

export function loadAlertRefreshStatus(): { runId: number; asOf: string; alerts: PublicationAlertSummary | null } | null {
  const run = getSqlite().prepare("SELECT id, as_of AS asOf, summary_json AS summary FROM market_scan_runs ORDER BY id DESC LIMIT 1").get() as { id: number; asOf: string; summary: string } | undefined;
  if (!run) return null;
  try {
    const summary = JSON.parse(run.summary);
    return { runId: run.id, asOf: run.asOf, alerts: summary.alerts?.method === PUBLICATION_ALERT_METHOD ? summary.alerts : null };
  } catch {
    return { runId: run.id, asOf: run.asOf, alerts: null };
  }
}
