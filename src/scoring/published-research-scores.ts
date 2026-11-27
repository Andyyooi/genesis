import { getSqlite } from "@/db/client";
import { buyScore, type BuyScore } from "@/lib/buy-score";

let cache: { version: number; scores: number[] } | null = null;

/** Latest published research score of every stock, the pool a Buy rank is ranked against. */
export function loadPublishedResearchScores(): number[] {
  const sqlite = getSqlite();
  const version = (sqlite.prepare("SELECT COALESCE(MAX(id), 0) AS version FROM score_runs").get() as { version: number }).version;
  if (cache && cache.version === version) return cache.scores;
  const rows = sqlite.prepare(`
    SELECT s.research_score AS score FROM score_runs s
    JOIN (SELECT instrument_id, MAX(id) AS id FROM score_runs GROUP BY instrument_id) latest ON latest.id = s.id
    JOIN instruments i ON i.id = s.instrument_id
    WHERE s.research_score IS NOT NULL AND COALESCE(i.listing_status, '') <> 'inactive'
  `).all() as { score: number }[];
  cache = { version, scores: rows.map((row) => row.score).filter(Number.isFinite) };
  return cache.scores;
}

export function publishedBuyScore(args: { researchScore: number | null; eligible: boolean; needsVerification: boolean }): BuyScore {
  return buyScore({ ...args, allResearchScores: loadPublishedResearchScores() });
}
