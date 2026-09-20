import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const categoryKeys = [
  "valuation",
  "quality",
  "financial_health",
  "growth",
  "news",
  "technical",
] as const;

const factorSetsSchema = z.object({
  valuation: z.array(z.unknown()),
  quality: z.array(z.unknown()),
  financial_health: z.array(z.unknown()),
  growth: z.array(z.unknown()),
  news: z.array(z.unknown()),
  technical: z.array(z.unknown()),
});

const instrumentProfileSchema = z.object({
  description: z.string(),
  factor_sets: factorSetsSchema,
});

const scoringSchema = z
  .object({
    version: z.number(),
    currency: z.literal("MYR"),
    category_weights: z.object({
      valuation: z.number(),
      quality: z.number(),
      financial_health: z.number(),
      growth: z.number(),
      news: z.number(),
      technical: z.number(),
    }),
    unavailable_until_data: z.array(z.enum(categoryKeys)),
    min_category_coverage: z.number().min(0).max(1),
    instrument_profiles: z.object({
      default: instrumentProfileSchema,
      reit: instrumentProfileSchema,
    }),
  })
  .superRefine((value, ctx) => {
    const sum = Object.values(value.category_weights).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      ctx.addIssue({
        code: "custom",
        message: `category_weights must sum to 100 (got ${sum})`,
        path: ["category_weights"],
      });
    }
  });

export type ScoringConfig = z.infer<typeof scoringSchema>;

export function loadScoringConfig(rootDir = process.cwd()): ScoringConfig {
  const path = join(rootDir, "config", "scoring.yaml");
  const raw = parse(readFileSync(path, "utf8"));
  return scoringSchema.parse(raw);
}

/** Phase 4 will call this instead of always using the industrial template. */
export function getFactorProfile(
  config: ScoringConfig,
  instrumentType: "COMMON_STOCK" | "REIT",
) {
  return instrumentType === "REIT"
    ? config.instrument_profiles.reit
    : config.instrument_profiles.default;
}
