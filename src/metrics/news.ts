import type { NewsClassification } from "@/ingest/classify";
import { NEWS_CLASSIFICATIONS, toneFromClassifications } from "@/ingest/classify";
import { available, unavailable, type EventSnapshot, type MetricValue } from "@/metrics/types";

function isClass(value: string): value is NewsClassification {
  return (NEWS_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function newsToneMetric(events: EventSnapshot[]): MetricValue {
  const formula =
    "mean of stored classifications (Positive catalyst=1, Negative=0, Neutral/Uncertain=0.5). No events → unavailable, not 0.5.";
  if (events.length === 0) {
    return unavailable(
      "news_tone",
      "Stored announcement tone",
      formula,
      "No stored announcements for this as-of date",
      [],
      null,
    );
  }
  const classes = events.map((e) => e.classification).filter(isClass);
  const tone = toneFromClassifications(classes);
  if (tone === null) {
    return unavailable(
      "news_tone",
      "Stored announcement tone",
      formula,
      "Stored rows have no recognised classification",
      [],
      events[0]?.occurredAt ?? null,
    );
  }
  return available(
    "news_tone",
    "Stored announcement tone",
    tone,
    "ratio",
    formula,
    events.map((event) => ({
      name: event.classification,
      value: event.classification === "Positive catalyst" ? 1 : event.classification === "Negative" ? 0 : 0.5,
      period: event.occurredAt,
    })),
    `${events[events.length - 1]?.occurredAt} → ${events[0]?.occurredAt}`,
  );
}
