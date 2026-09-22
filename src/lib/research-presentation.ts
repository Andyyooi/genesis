import { CATEGORY_LABELS, formatContextHeadline, formatScore100 } from "@/lib/research-copy";
import { formatMetricValue } from "@/lib/format-metric";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import type { CategoryScore, ScoreResult } from "@/scoring/types";

export const RESEARCH_SCORE_BLURB =
  "Research Score reflects currently available valuation, quality, health, growth, news and market evidence. Missing factors are excluded and remaining weights are renormalized. It is not a buy or sell recommendation.";

export function researchScoreBlurb(result: ScoreResult): string {
  const omitted = result.categories
    .filter((c) => !c.inThisRun)
    .map((c) => CATEGORY_LABELS[c.id] ?? c.id);
  if (omitted.length === 0) return RESEARCH_SCORE_BLURB;
  return `${RESEARCH_SCORE_BLURB} Not in this run: ${omitted.join(", ")}.`;
}

export function liveWeightLabel(category: CategoryScore): string {
  if (!category.inThisRun || category.liveWeight === null) {
    return "Not in this run";
  }
  return `${Math.round(category.liveWeight * 100)}% of this run`;
}

export function factorAvailabilityLabel(available: boolean, reason: string | null): string {
  if (available) return "Available";
  return reason?.trim() ? `Unavailable — ${reason}` : "Unavailable — insufficient data";
}

/** Detect Phase 16 curated fixture / sample rows so UI does not present them as live news. */
export function isFixtureEvent(event: EventSnapshot): boolean {
  const blob = [
    event.source,
    event.sourceReliability,
    event.headline,
    event.excerpt,
    event.relevanceNote,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    event.sourceReliability === "CURATED" ||
    blob.includes("fixture") ||
    blob.includes("curated") ||
    blob.includes("sample row") ||
    blob.includes("not a scraped") ||
    blob.includes("ir index pointer") ||
    blob.includes("example (not a scraped")
  );
}

/**
 * Factual research interpretation bullets from existing score/metric/context data.
 * No recommendations, no invented metrics.
 */
export function researchInterpretationBullets(args: {
  result: ScoreResult;
  metrics: MetricValue[];
  events: EventSnapshot[];
}): string[] {
  const { result, metrics, events } = args;
  const bullets: string[] = [];
  const byId = (id: string) => metrics.find((m) => m.id === id);

  bullets.push(
    `Research profile: ${result.researchProfile}${result.researchProfileReason ? ` — ${result.researchProfileReason}` : ""}.`,
  );

  const val = result.categories.find((c) => c.id === "valuation");
  if (val?.inThisRun && val.score !== null) {
    bullets.push(`Absolute Valuation category score is ${formatScore100(val.score)} in this run.`);
  } else {
    bullets.push("Absolute Valuation category is not in this run (insufficient valuation inputs).");
  }

  for (const id of ["price_to_earnings", "price_to_book", "dividend_yield", "book_nav_premium"]) {
    const m = byId(id);
    if (m?.available && m.value !== null) {
      bullets.push(`${m.label}: ${formatMetricValue(m)}${m.period ? ` (period ${m.period})` : ""}.`);
    }
  }

  bullets.push(
    `Historical valuation context: ${formatContextHeadline(result.valuationContext.historical.label)} (${result.valuationContext.historical.historicalValuationStatus.replaceAll("_", " ")}).`,
  );
  if (result.valuationContext.historical.limitation) {
    bullets.push(result.valuationContext.historical.limitation);
  }

  const peer = result.valuationContext.peer;
  const pq = peer.peerQuality;
  if (pq) {
    bullets.push(
      `Peer context: ${formatContextHeadline(peer.label)} — ${pq.groupType.replaceAll("_", " ")}; ${pq.usableCount} usable peers (${pq.selectionPath}).`,
    );
  } else {
    bullets.push(`Peer context: ${formatContextHeadline(peer.label)}.`);
    if (peer.limitation) bullets.push(peer.limitation);
  }

  for (const id of ["roe", "net_margin", "revenue_cagr", "pat_cagr", "dpu_cagr", "reit_gearing"]) {
    const m = byId(id);
    if (m?.available && m.value !== null) {
      bullets.push(`${m.label}: ${formatMetricValue(m)}${m.period ? ` (period ${m.period})` : ""}.`);
    }
  }

  const c = result.dataCoverage;
  bullets.push(
    `Data coverage ${Math.round(c.coverageRatio * 100)}% (${c.available} of ${c.expected} core factors); freshness ${c.freshness.replaceAll("_", " ")}; confidence ${result.dataConfidence.level}.`,
  );
  if (!c.availableAt) {
    bullets.push(
      "Point-in-time filing availability (available_at) is unknown for the latest annual used — historical series may be period-end only.",
    );
  }

  if (events.length === 0) {
    bullets.push("No stored company events in the research database for this name.");
  } else {
    const fixtureCount = events.filter(isFixtureEvent).length;
    bullets.push(
      `${events.length} stored event(s) on this page (display-only; not used in Research Score)${fixtureCount ? `, including ${fixtureCount} curated/fixture row(s)` : ""}.`,
    );
  }

  return bullets;
}

export function absoluteValuationBlurb(): string {
  return "Based on Genesis’s valuation factor model for this research profile. Historical and peer labels are separate and do not change this score.";
}
