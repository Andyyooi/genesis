import { createHash } from "node:crypto";
import type { EventConfidence, EventDraft, MappingConfidence, SourceReliability } from "@/events/types";

/** Prefer source+sourceId; else canonical URL; else normalized headline+company+published date. */
export function buildDedupeKey(draft: Pick<EventDraft, "source" | "sourceId" | "sourceUrl" | "headline" | "ticker" | "companyName" | "publishedAt" | "occurredAt">): string {
  if (draft.sourceId?.trim()) {
    return `sid:${draft.source.trim().toLowerCase()}|${draft.sourceId.trim()}`;
  }
  if (draft.sourceUrl?.trim()) {
    return `url:${normalizeUrl(draft.sourceUrl)}`;
  }
  const when = (draft.publishedAt ?? draft.occurredAt ?? "").slice(0, 10);
  const company = (draft.ticker ?? draft.companyName ?? "").trim().toLowerCase();
  const headline = normalizeHeadline(draft.headline);
  return `hlt:${company}|${when}|${headline}`;
}

export function normalizeHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return u.toString().toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Event confidence rubric (documented for UI/tests):
 * - HIGH: PRIMARY/CURATED source + HIGH mapping + published_at known
 * - MEDIUM: mapped ticker + published_at known + CURATED/PRIMARY
 * - LOW: mapped but published_at unknown, or LOW mapping
 * - UNKNOWN: unmapped / ambiguous
 */
export function deriveEventConfidence(args: {
  mappingConfidence: MappingConfidence;
  publishedAt: string | null;
  sourceReliability: SourceReliability;
}): EventConfidence {
  if (args.mappingConfidence === "UNMAPPED" || args.mappingConfidence === "AMBIGUOUS") {
    return "UNKNOWN";
  }
  if (!args.publishedAt) return "LOW";
  if (args.mappingConfidence === "LOW") return "LOW";
  if (
    (args.sourceReliability === "PRIMARY" || args.sourceReliability === "CURATED") &&
    args.mappingConfidence === "HIGH"
  ) {
    return "HIGH";
  }
  if (args.mappingConfidence === "MEDIUM" || args.mappingConfidence === "HIGH") {
    return "MEDIUM";
  }
  return "UNKNOWN";
}

export function stableSourceId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}
