import { eq, or } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import type { EventDraft, MappingConfidence } from "@/events/types";

type Db = ReturnType<typeof getDb>;

export type InstrumentMapHit = {
  instrumentId: number | null;
  mappingConfidence: MappingConfidence;
  mappingNote: string;
};

/**
 * Map an event draft to instruments.
 * Prefer ticker, then Bursa code, then exact name. Never attach on weak name guesses.
 */
export function mapEventToInstrument(db: Db, draft: EventDraft): InstrumentMapHit {
  if (draft.ticker?.trim()) {
    const ticker = draft.ticker.trim().toUpperCase();
    const row = db.select().from(instruments).where(eq(instruments.ticker, ticker)).get();
    if (row) {
      return {
        instrumentId: row.id,
        mappingConfidence: "HIGH",
        mappingNote: `Mapped by ticker ${ticker}.`,
      };
    }
    return {
      instrumentId: null,
      mappingConfidence: "UNMAPPED",
      mappingNote: `Ticker ${ticker} is not in the instruments universe.`,
    };
  }

  if (draft.bursaCode?.trim()) {
    const code = draft.bursaCode.trim();
    const matches = db
      .select()
      .from(instruments)
      .where(or(eq(instruments.bursaCode, code), eq(instruments.bursaCode, code.replace(/^0+/, ""))))
      .all();
    if (matches.length === 1) {
      return {
        instrumentId: matches[0].id,
        mappingConfidence: "HIGH",
        mappingNote: `Mapped by Bursa code ${code}.`,
      };
    }
    if (matches.length > 1) {
      return {
        instrumentId: null,
        mappingConfidence: "AMBIGUOUS",
        mappingNote: `Bursa code ${code} matched ${matches.length} instruments — left unmapped for review.`,
      };
    }
    return {
      instrumentId: null,
      mappingConfidence: "UNMAPPED",
      mappingNote: `Bursa code ${code} not found in instruments.`,
    };
  }

  if (draft.companyName?.trim()) {
    const name = draft.companyName.trim().toLowerCase();
    const all = db.select().from(instruments).all();
    const exact = all.filter((row) => row.name.trim().toLowerCase() === name);
    if (exact.length === 1) {
      return {
        instrumentId: exact[0].id,
        mappingConfidence: "MEDIUM",
        mappingNote: `Mapped by exact company name “${draft.companyName}”.`,
      };
    }
    if (exact.length > 1) {
      return {
        instrumentId: null,
        mappingConfidence: "AMBIGUOUS",
        mappingNote: `Company name “${draft.companyName}” matched multiple instruments — left unmapped.`,
      };
    }
    // Partial / fuzzy name matching intentionally omitted (too weak).
    return {
      instrumentId: null,
      mappingConfidence: "UNMAPPED",
      mappingNote: `No exact name match for “${draft.companyName}”. Not attached by guess.`,
    };
  }

  return {
    instrumentId: null,
    mappingConfidence: "UNMAPPED",
    mappingNote: "No ticker, Bursa code, or company name supplied.",
  };
}

/** Multi-company mention: leave unmapped when more than one distinct HIGH ticker token is present. */
export function detectMultiCompanyAmbiguity(db: Db, text: string): InstrumentMapHit | null {
  const tickers = db.select({ ticker: instruments.ticker, id: instruments.id }).from(instruments).all();
  const upper = text.toUpperCase();
  const hits = tickers.filter((row) => {
    const re = new RegExp(`\\b${row.ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(upper);
  });
  const unique = [...new Map(hits.map((h) => [h.id, h])).values()];
  if (unique.length > 1) {
    return {
      instrumentId: null,
      mappingConfidence: "AMBIGUOUS",
      mappingNote: `Headline mentions multiple tickers (${unique.map((u) => u.ticker).join(", ")}) — left unmapped.`,
    };
  }
  return null;
}

export function mapDraftWithGuards(db: Db, draft: EventDraft): InstrumentMapHit {
  const multi = detectMultiCompanyAmbiguity(
    db,
    `${draft.headline}\n${draft.excerpt ?? ""}\n${draft.companyName ?? ""}`,
  );
  // Only apply multi-ticker guard when draft did not already pin a single ticker.
  if (multi && !draft.ticker?.trim()) return multi;
  if (multi && draft.ticker?.trim()) {
    // Headline mentions several tickers but draft is pinned — keep pin, note it.
    const primary = mapEventToInstrument(db, draft);
    if (primary.instrumentId !== null) {
      return {
        ...primary,
        mappingNote: `${primary.mappingNote} Headline also mentions other tickers; draft ticker wins.`,
      };
    }
  }
  return mapEventToInstrument(db, draft);
}
