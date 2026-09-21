import { eq } from "drizzle-orm";
import { loadScoringConfig, profileRulesFromConfig } from "@/config/load-scoring";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { classifyResearchProfile } from "@/research/profiles";

export function assignResearchProfiles(): { updated: number } {
  const db = getDb();
  const rules = profileRulesFromConfig(loadScoringConfig());
  const rows = db.select().from(instruments).all();
  let updated = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const next = classifyResearchProfile({
      instrumentType: row.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
      industry: row.industry,
      sector: row.sector,
      ticker: row.ticker,
      explicit: null,
      rules,
    });
    if (row.researchProfile === next.profile) continue;
    db.update(instruments)
      .set({ researchProfile: next.profile, updatedAt: now })
      .where(eq(instruments.id, row.id))
      .run();
    updated += 1;
  }
  return { updated };
}
