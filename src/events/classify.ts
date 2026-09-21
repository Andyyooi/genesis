import type { EventSentiment, EventType } from "@/events/types";
import { classifyAnnouncement } from "@/ingest/classify";

const TYPE_RULES: { type: EventType; keys: string[] }[] = [
  { type: "PN17", keys: ["pn17", "gn3"] },
  { type: "SUSPENSION", keys: ["trading suspension", "suspended from trading"] },
  { type: "DIVIDEND", keys: ["dividend", "distribution", "income distribution"] },
  { type: "RESULTS", keys: ["net profit", "quarterly results", "fy results", "financial results", "results announcement"] },
  { type: "EARNINGS", keys: ["earnings", "1q ", "2q ", "3q ", "4q ", "9m fy"] },
  { type: "SHARE_BUYBACK", keys: ["share buyback", "buy-back", "share buy-back"] },
  { type: "RIGHTS_ISSUE", keys: ["rights issue"] },
  { type: "PLACEMENT", keys: ["private placement", "placement of"] },
  { type: "CAPITAL_RAISE", keys: ["capital raise", "fund raising", "fundraising"] },
  { type: "ACQUISITION", keys: ["acquisition of", "acquires", "proposed acquisition"] },
  { type: "DISPOSAL", keys: ["disposal of", "proposed disposal"] },
  { type: "MERGER", keys: ["merger", "scheme of arrangement"] },
  { type: "DEBT", keys: ["sukuk", "bond issuance", "mtn programme"] },
  { type: "CONTRACT", keys: ["contract award", "awarded a contract", "letter of award"] },
  { type: "MAJOR_CONTRACT", keys: ["major contract", "material contract"] },
  { type: "JV", keys: ["joint venture", " joint venture"] },
  { type: "MANAGEMENT_CHANGE", keys: ["change in boardroom", "appointment of", "resignation of", "chief executive"] },
  { type: "REGULATORY", keys: ["query from bursa", "unusual market activity"] },
  { type: "EXPANSION", keys: ["expansion", "new store", "new outlet"] },
  { type: "OPERATIONAL_UPDATE", keys: ["operational update", "business update"] },
  { type: "LISTING", keys: ["initial public offering", "listing of"] },
];

export function classifyEventType(headline: string, excerpt: string | null): EventType {
  const text = `${headline}\n${excerpt ?? ""}`.toLowerCase();
  for (const rule of TYPE_RULES) {
    if (rule.keys.some((k) => text.includes(k))) return rule.type;
  }
  return "UNKNOWN";
}

/** Map Phase 8 keyword classification into Phase 16 sentiment (not a trade signal). */
export function sentimentFromLegacyClassification(classification: string): EventSentiment {
  if (classification === "Positive catalyst") return "POSITIVE";
  if (classification === "Negative") return "NEGATIVE";
  if (classification === "Neutral") return "NEUTRAL";
  if (classification === "Uncertain") return "UNCERTAIN";
  return "UNKNOWN";
}

export function classifyEventSentiment(headline: string, excerpt: string | null): {
  sentiment: EventSentiment;
  classification: string;
  relevanceNote: string;
} {
  const legacy = classifyAnnouncement(headline, excerpt);
  return {
    sentiment: sentimentFromLegacyClassification(legacy.classification),
    classification: legacy.classification,
    relevanceNote: legacy.relevanceNote,
  };
}

/**
 * Materiality is NOT inferred from sentiment alone.
 * Only a few announcement families get a non-UNKNOWN default; everything else stays UNKNOWN for review.
 */
export function defaultMateriality(eventType: EventType): "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" {
  if (eventType === "PN17" || eventType === "SUSPENSION" || eventType === "REGULATORY") return "HIGH";
  if (
    eventType === "RESULTS" ||
    eventType === "EARNINGS" ||
    eventType === "DIVIDEND" ||
    eventType === "ACQUISITION" ||
    eventType === "DISPOSAL" ||
    eventType === "MERGER" ||
    eventType === "MAJOR_CONTRACT"
  ) {
    return "MEDIUM";
  }
  if (eventType === "MANAGEMENT_CHANGE" || eventType === "OPERATIONAL_UPDATE") return "LOW";
  return "UNKNOWN";
}
