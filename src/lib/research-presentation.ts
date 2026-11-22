import { CATEGORY_LABELS, formatContextHeadline, formatScore100 } from "@/lib/research-copy";
import { formatMetricValue } from "@/lib/format-metric";
import { financialTerm } from "@/lib/financial-terms";
import type { EventSnapshot, MetricValue } from "@/metrics/types";
import type { CategoryScore, ScoreResult } from "@/scoring/types";

export const RESEARCH_SCORE_BLURB =
  "Research Score combines comparisons of price, profitability, price trends, price swings, financial strength and growth. Higher means a stronger comparison, not a predicted return. Banks and property funds are compared within their own groups. Missing checks are left out and the remaining checks share the weight. News does not affect the score. This is not a buy or sell recommendation.";

export function researchScoreBlurb(result: ScoreResult): string {
  const omitted = result.categories
    .filter((c) => !c.inThisRun)
    .map((c) => CATEGORY_LABELS[c.id] ?? c.id);
  if (omitted.length === 0) return RESEARCH_SCORE_BLURB;
  return `${RESEARCH_SCORE_BLURB} Not in this run: ${omitted.join(", ")}.`;
}

export function researchVerdict(score: number | null, needsVerification: boolean) {
  if (score === null || !Number.isFinite(score)) return {
    label: "Not enough evidence", tone: "UNKNOWN", why: "The saved data did not support a research score.",
  };
  if (needsVerification) return {
    label: "Check the evidence", tone: "LOW", why: "Some key figures are missing or old, so treat this score with caution.",
  };
  if (score >= 70) return {
    label: "Strong research score", tone: "HIGH", why: "On balance, the saved financial and price checks compare well with other stocks.",
  };
  if (score >= 45) return {
    label: "Mid-range research score", tone: "MEDIUM", why: "On balance, the saved checks put this stock near the middle of the comparison.",
  };
  return {
    label: "Weaker research score", tone: "VERY_LOW", why: "On balance, other stocks compare better on the saved financial and price checks.",
  };
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
    bullets.push(`Relative Value category score is ${formatScore100(val.score)} in this stored run.`);
  } else {
    bullets.push("Relative Value category is not in this run (insufficient valuation inputs).");
  }

  const valueMetrics = result.profile === "reit" ? ["dividend_yield", "book_nav_premium"] : ["price_to_earnings", "price_to_book", "dividend_yield"];
  for (const id of valueMetrics) {
    const m = byId(id);
    if (m?.available && m.value !== null) {
      const term = financialTerm(id, m.label);
      bullets.push(`${term.label} (${term.technical}): ${formatMetricValue(m)}${m.period ? ` (period ${m.period})` : ""}. ${term.explanation}`);
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

  const profileMetrics = result.profile === "reit" ? ["dpu_cagr", "reit_gearing"] : ["roe", "revenue_cagr", "eps_cagr"];
  for (const id of profileMetrics) {
    const m = byId(id);
    if (m?.available && m.value !== null) {
      const term = financialTerm(id, m.label);
      bullets.push(`${term.label} (${term.technical}): ${formatMetricValue(m)}${m.period ? ` (period ${m.period})` : ""}. ${term.explanation}`);
    }
    if (!m?.available && m?.reason?.includes("definition break")) bullets.push(m.reason);
  }

  const c = result.dataCoverage;
  bullets.push(
    `${c.available} of ${c.expected} financial and price checks have usable data (${Math.round(c.coverageRatio * 100)}%). Trust in the evidence: ${result.dataConfidence.level.toLowerCase()}, based on completeness and account age — not a judgement of investment safety.`,
  );
  if (!c.availableAt) {
    bullets.push(
      "We do not know when the latest annual accounts became public. Historical comparisons may use information that was not yet available to investors.",
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
  return "Compares how much accounting value you get for the price against other scored companies. Higher is relatively better value, not proof the share is cheap or an estimate of its true worth. Comparisons with past years and similar companies below do not change this score.";
}
