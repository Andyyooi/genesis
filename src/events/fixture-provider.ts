import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyEventSentiment,
  classifyEventType,
  defaultMateriality,
} from "@/events/classify";
import { stableSourceId } from "@/events/dedupe";
import type { EventDraft, EventSourceProvider, SourceReliability } from "@/events/types";

type FixtureFile = {
  source: string;
  reliability: SourceReliability;
  note: string;
  events: Array<{
    ticker: string;
    bursa_code?: string | null;
    company_name?: string | null;
    published_at: string;
    available_at?: string | null;
    source?: string;
    source_url: string;
    source_id?: string | null;
    headline: string;
    excerpt?: string | null;
    event_type?: string;
    sentiment?: string;
    materiality?: string;
  }>;
};

/**
 * Curated, hand-labelled company IR / public announcement rows.
 * Not a live scrape. Used because Bursa Malaysia is Cloudflare-gated and
 * no official public announcements API key is configured in this repo.
 */
export class CuratedFixtureEventProvider implements EventSourceProvider {
  readonly id = "curated-fixture";
  readonly reliability: SourceReliability = "CURATED";

  constructor(private readonly filePath = defaultFixturePath()) {}

  async list(tickers: string[]): Promise<EventDraft[]> {
    const wanted = new Set(tickers.map((t) => t.toUpperCase()));
    const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as FixtureFile;
    const drafts: EventDraft[] = [];
    for (const row of raw.events) {
      const ticker = row.ticker.toUpperCase();
      if (wanted.size && !wanted.has(ticker)) continue;
      const excerpt = row.excerpt ?? null;
      const typed = classifyEventType(row.headline, excerpt);
      const tone = classifyEventSentiment(row.headline, excerpt);
      const publishedAt = row.published_at;
      drafts.push({
        ticker,
        bursaCode: row.bursa_code ?? null,
        companyName: row.company_name ?? null,
        eventType: (row.event_type as EventDraft["eventType"]) ?? typed,
        headline: row.headline,
        excerpt,
        source: row.source ?? raw.source,
        sourceUrl: row.source_url,
        sourceId:
          row.source_id ??
          stableSourceId([raw.source, ticker, publishedAt, row.headline]),
        publishedAt,
        occurredAt: publishedAt.slice(0, 10),
        // Known publication date → available_at set for PIT (equals published_at).
        availableAt: row.available_at === undefined ? publishedAt : row.available_at,
        sentiment: (row.sentiment as EventDraft["sentiment"]) ?? tone.sentiment,
        materiality:
          (row.materiality as EventDraft["materiality"]) ?? defaultMateriality(typed),
        sourceReliability: raw.reliability ?? "CURATED",
        classification: tone.classification,
        relevanceNote: `${tone.relevanceNote} Fixture note: curated public IR/newsroom URL — not a scraped Bursa PDF dump.`,
      });
    }
    return drafts;
  }
}

export function defaultFixturePath() {
  return join(process.cwd(), "data", "raw", "events-phase16-fixture.json");
}

/** Documented stub: live Bursa / KLSE Screener fetch is not enabled in Phase 16. */
export class UnavailableLiveBursaEventProvider implements EventSourceProvider {
  readonly id = "bursa-live-unavailable";
  readonly reliability: SourceReliability = "UNKNOWN";

  async list(): Promise<EventDraft[]> {
    return [];
  }
}
