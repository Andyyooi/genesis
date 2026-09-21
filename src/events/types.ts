/**
 * Phase 16 event taxonomy, sentiment, materiality, and confidence.
 * Facts stay separate from interpretation. Not BUY/SELL signals.
 */

export const EVENT_TYPES = [
  "RESULTS",
  "EARNINGS",
  "DIVIDEND",
  "GUIDANCE",
  "ACQUISITION",
  "DISPOSAL",
  "MERGER",
  "CAPITAL_RAISE",
  "RIGHTS_ISSUE",
  "PLACEMENT",
  "SHARE_BUYBACK",
  "DEBT",
  "CONTRACT",
  "JV",
  "MANAGEMENT_CHANGE",
  "LISTING",
  "PN17",
  "SUSPENSION",
  "REGULATORY",
  "MATERIAL_ANNOUNCEMENT",
  "MAJOR_CONTRACT",
  "EXPANSION",
  "NEW_PROJECT",
  "OPERATIONAL_UPDATE",
  "OTHER",
  "UNKNOWN",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Separate from event type. Not a recommendation. */
export const EVENT_SENTIMENTS = ["POSITIVE", "NEGATIVE", "NEUTRAL", "UNCERTAIN", "UNKNOWN"] as const;
export type EventSentiment = (typeof EVENT_SENTIMENTS)[number];

export const EVENT_MATERIALITIES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type EventMateriality = (typeof EVENT_MATERIALITIES)[number];

/**
 * How much we trust the stored row as research evidence.
 * HIGH: verified ticker/Bursa code map + known published_at + primary IR/Bursa-labelled source.
 * MEDIUM: firm ticker map + known published date + secondary/curated source.
 * LOW: weak map or missing publication date.
 * UNKNOWN: insufficient metadata.
 */
export const EVENT_CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type EventConfidence = (typeof EVENT_CONFIDENCES)[number];

export const MAPPING_CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "AMBIGUOUS", "UNMAPPED"] as const;
export type MappingConfidence = (typeof MAPPING_CONFIDENCES)[number];

export const SOURCE_RELIABILITIES = ["PRIMARY", "CURATED", "SECONDARY", "UNKNOWN"] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];

/** Draft emitted by a News/Event provider before DB upsert. */
export type EventDraft = {
  /** Prefer stable ticker when known. */
  ticker: string | null;
  bursaCode: string | null;
  companyName: string | null;
  eventType: EventType;
  headline: string;
  excerpt: string | null;
  source: string;
  sourceUrl: string | null;
  sourceId: string | null;
  /** When the market could know. Never invent. ISO date or datetime. */
  publishedAt: string | null;
  /** Alias kept for Phase 8 CSV compatibility (date of event). */
  occurredAt: string | null;
  /**
   * PIT field: when an investor could see it.
   * For primary IR/Bursa rows with a known published date, equals publishedAt.
   * Null when publication time is unknown — not PIT-safe.
   */
  availableAt: string | null;
  sentiment: EventSentiment;
  materiality: EventMateriality;
  sourceReliability: SourceReliability;
  /** Legacy Phase 8 display classification. */
  classification: string;
  relevanceNote: string | null;
};

export type MappedEventDraft = EventDraft & {
  instrumentId: number | null;
  mappingConfidence: MappingConfidence;
  mappingNote: string;
  eventConfidence: EventConfidence;
  dedupeKey: string;
  retrievedAt: string;
};

export interface EventSourceProvider {
  readonly id: string;
  readonly reliability: SourceReliability;
  /**
   * Fetch or load drafts for the given tickers.
   * Implementations must not invent publication dates.
   */
  list(tickers: string[]): Promise<EventDraft[]>;
}
