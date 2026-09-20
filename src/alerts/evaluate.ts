import type { ScoringConfig } from "@/config/load-scoring";
import type { EventSnapshot } from "@/metrics/types";
import { categoryScore, researchListIds, type ListId } from "@/opportunities/lists";
import type { ScoreResult } from "@/scoring/types";

export type AlertDraft = {
  ruleId: string;
  ticker: string;
  title: string;
  why: string;
  evidence: Record<string, unknown>;
  fingerprint: string;
  href: string;
};

export type AlertSnapshot = {
  lastResearchScore: number | null;
  lastHealthScore: number | null;
  lastConcernIds: string[];
  lastListIds: ListId[];
  lastEventKeys: string[];
  lastClose: number | null;
  lastCloseDate: string | null;
};

export type AlertInputs = {
  ticker: string;
  name: string;
  result: ScoreResult;
  events: EventSnapshot[];
  lastClose: number | null;
  lastCloseDate: string | null;
  close1dAgo: number | null;
  close5dAgo: number | null;
  valuationScore: number | null;
  qualityScore: number | null;
  persistedResearchScores: (number | null)[];
  distanceFrom52wHigh: number | null;
  distanceFrom52wHighAvailable: boolean;
  catalystWatch: boolean;
  fundamentalsPeriod: string | null;
  demoPriorScore: number | null;
};

function href(ticker: string): string {
  return `/stock/${ticker}`;
}

export function eventKey(event: EventSnapshot): string {
  return `${event.occurredAt}|${event.headline}`;
}

export function isEarningsHeadline(headline: string): boolean {
  const text = headline.toLowerCase();
  return (
    text.includes("net profit") ||
    text.includes("earnings") ||
    text.includes("quarterly rpt") ||
    text.includes("financial period") ||
    /\b[1-4]q fy/.test(text) ||
    /\b9m fy/.test(text)
  );
}

function fmtScore(value: number | null): string {
  if (value === null) return "Data unavailable";
  return value.toFixed(1);
}

export function buildCurrentSnapshot(input: AlertInputs): AlertSnapshot {
  return {
    lastResearchScore: input.result.researchScore,
    lastHealthScore: categoryScore(input.result, "financial_health"),
    lastConcernIds: input.result.concerns.map((c) => c.id),
    lastListIds: researchListIds({
      valuationScore: input.valuationScore,
      qualityScore: input.qualityScore,
      persistedResearchScores: input.persistedResearchScores,
      distanceFrom52wHigh: input.distanceFrom52wHigh,
      distanceFrom52wHighAvailable: input.distanceFrom52wHighAvailable,
      catalystWatch: input.catalystWatch,
    }),
    lastEventKeys: input.events.map(eventKey),
    lastClose: input.lastClose,
    lastCloseDate: input.lastCloseDate,
  };
}

export function evaluateAlertDrafts(
  config: ScoringConfig,
  input: AlertInputs,
  previous: AlertSnapshot | null,
): AlertDraft[] {
  const drafts: AlertDraft[] = [];
  const ticker = input.ticker;
  const thresholds = config.alerts;
  const currentLists = buildCurrentSnapshot(input).lastListIds;
  const fyNote = `Fundamentals period ${input.fundamentalsPeriod ?? "Data unavailable"}; price as-of ${input.lastCloseDate ?? "Data unavailable"}. Later calendar years are not invented filings.`;

  const priorScore =
    input.demoPriorScore !== null
      ? input.demoPriorScore
      : (previous?.lastResearchScore ?? null);
  const currentScore = input.result.researchScore;
  if (priorScore !== null && currentScore !== null) {
    const delta = currentScore - priorScore;
    if (Math.abs(delta) >= thresholds.score_delta) {
      const up = delta > 0;
      drafts.push({
        ruleId: up ? "research_score_up" : "research_score_down",
        ticker,
        title: `${ticker} Research Score ${fmtScore(priorScore)} → ${fmtScore(currentScore)}`,
        why: up
          ? `${ticker} Research Score ${fmtScore(priorScore)} → ${fmtScore(currentScore)}. ${
              input.demoPriorScore !== null
                ? "The earlier figure is a documented demo score_run (same FY filings; news omitted) so a change is visible. "
                : ""
            }Latest mix: ${input.result.notes[0] ?? "see category breakdown"}. ${fyNote} Not a buy or sell.`
          : `${ticker} Research Score ${fmtScore(priorScore)} → ${fmtScore(currentScore)}. ${fyNote} Not a sell signal.`,
        evidence: {
          from: priorScore,
          to: currentScore,
          demo: input.demoPriorScore !== null,
          notes: input.result.notes,
        },
        fingerprint: `${priorScore.toFixed(2)}->${currentScore.toFixed(2)}`,
        href: href(ticker),
      });
    }
  }

  const prevConcerns = new Set(previous?.lastConcernIds ?? []);
  for (const concern of input.result.concerns) {
    if (prevConcerns.has(concern.id)) continue;
    drafts.push({
      ruleId: "new_concern",
      ticker,
      title: `${ticker} new Potential Concern: ${concern.label}`,
      why: `${concern.label}. ${concern.message}${
        concern.value !== null ? ` Value ${concern.value}.` : ""
      }${concern.period ? ` Period ${concern.period}.` : ""} This warning does not change the Research Score. Not a sell stamp.`,
      evidence: { concern },
      fingerprint: concern.id,
      href: href(ticker),
    });
  }

  const prevEvents = new Set(previous?.lastEventKeys ?? []);
  for (const event of input.events) {
    const key = eventKey(event);
    if (prevEvents.has(key)) continue;
    if (!isEarningsHeadline(event.headline)) continue;
    drafts.push({
      ruleId: "earnings_announcement",
      ticker,
      title: `${ticker} results announcement`,
      why: `New stored results headline on ${event.occurredAt}: “${event.headline}” (${event.source}). Classification ${event.classification}. Headlines are not facts — open the original. ${fyNote}`,
      evidence: {
        occurredAt: event.occurredAt,
        source: event.source,
        sourceUrl: event.sourceUrl,
        headline: event.headline,
        classification: event.classification,
      },
      fingerprint: key,
      href: href(ticker),
    });
  }

  const prevHealth = previous?.lastHealthScore ?? null;
  const health = categoryScore(input.result, "financial_health");
  if (prevHealth !== null && health !== null && prevHealth - health >= thresholds.health_delta) {
    drafts.push({
      ruleId: "health_deterioration",
      ticker,
      title: `${ticker} financial health ${fmtScore(prevHealth)} → ${fmtScore(health)}`,
      why: `Financial health score fell ${fmtScore(prevHealth)} → ${fmtScore(health)} on stored metrics (threshold ${thresholds.health_delta} points). Missing health stays Data unavailable — this rule did not invent leverage. ${fyNote}`,
      evidence: { from: prevHealth, to: health },
      fingerprint: `${prevHealth.toFixed(2)}->${health.toFixed(2)}`,
      href: href(ticker),
    });
  }

  if (
    previous?.lastClose !== null &&
    previous?.lastClose !== undefined &&
    previous.lastClose > 0 &&
    input.lastClose !== null &&
    input.lastCloseDate &&
    previous.lastCloseDate !== input.lastCloseDate
  ) {
    const move1d =
      input.close1dAgo && input.close1dAgo > 0
        ? (input.lastClose - input.close1dAgo) / input.close1dAgo
        : (input.lastClose - previous.lastClose) / previous.lastClose;
    const move5d =
      input.close5dAgo && input.close5dAgo > 0
        ? (input.lastClose - input.close5dAgo) / input.close5dAgo
        : null;
    const hit1d = Math.abs(move1d) >= thresholds.price_move_1d;
    const hit5d = move5d !== null && Math.abs(move5d) >= thresholds.price_move_5d;
    if (hit1d || hit5d) {
      const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
      drafts.push({
        ruleId: "large_price_move",
        ticker,
        title: `${ticker} large stored price move`,
        why: `Last close ${input.lastClose.toFixed(3)} on ${input.lastCloseDate}. Move vs prior bar ${pct(move1d)}${
          move5d !== null ? `; vs ~5 sessions ${pct(move5d)}` : ""
        }. Thresholds ${(thresholds.price_move_1d * 100).toFixed(0)}% / ${(thresholds.price_move_5d * 100).toFixed(0)}%. Price as-of is the Yahoo bar, not a new filing. Not a trade instruction.`,
        evidence: { lastClose: input.lastClose, lastCloseDate: input.lastCloseDate, move1d, move5d },
        fingerprint: `${previous.lastCloseDate}:${previous.lastClose}->${input.lastCloseDate}:${input.lastClose}`,
        href: href(ticker),
      });
    }
  }

  const prevLists = new Set(previous?.lastListIds ?? []);
  for (const listId of currentLists) {
    if (prevLists.has(listId)) continue;
    drafts.push({
      ruleId: "new_opportunity",
      ticker,
      title: `${ticker} joined ${listId} research list`,
      why: `${input.name} now matches the “${listId}” research list on stored scores/events. These lists are not buy orders. ${fyNote}`,
      evidence: { listId, lists: currentLists },
      fingerprint: listId,
      href: href(ticker),
    });
  }

  return drafts;
}
