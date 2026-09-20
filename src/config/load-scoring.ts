import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const CATEGORY_KEYS = [
  "valuation",
  "quality",
  "financial_health",
  "growth",
  "news",
  "technical",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const factorSchema = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive(),
  direction: z.enum(["higher_better", "lower_better"]),
  worse: z.number(),
  better: z.number(),
});

const factorSetsSchema = z.object({
  valuation: z.array(factorSchema),
  quality: z.array(factorSchema),
  financial_health: z.array(factorSchema),
  growth: z.array(factorSchema),
  news: z.array(factorSchema),
  technical: z.array(factorSchema),
});

const instrumentProfileSchema = z.object({
  description: z.string(),
  factor_sets: factorSetsSchema,
});

const concernRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  message: z.string(),
  metric: z.string().optional(),
  when: z.enum(["value_lt", "value_gt", "instrument_pn17"]),
  threshold: z.number().optional(),
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
    unavailable_until_data: z.array(z.enum(CATEGORY_KEYS)),
    min_category_coverage: z.number().min(0).max(1),
    concerns: z.object({
      apply_score_penalty: z.boolean(),
      rules: z.array(concernRuleSchema),
    }),
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
    for (const profileName of ["default", "reit"] as const) {
      const sets = value.instrument_profiles[profileName].factor_sets;
      for (const key of CATEGORY_KEYS) {
        const factors = sets[key];
        if (factors.length === 0) continue;
        const factorSum = factors.reduce((a, f) => a + f.weight, 0);
        if (Math.abs(factorSum - 100) > 0.001) {
          ctx.addIssue({
            code: "custom",
            message: `${profileName}.${key} factor weights must sum to 100 (got ${factorSum})`,
            path: ["instrument_profiles", profileName, "factor_sets", key],
          });
        }
      }
    }
  });

export type ScoringConfig = z.infer<typeof scoringSchema>;
export type FactorConfig = z.infer<typeof factorSchema>;
export type ConcernRule = z.infer<typeof concernRuleSchema>;

export function loadScoringConfig(rootDir = process.cwd()): ScoringConfig {
  const path = join(rootDir, "config", "scoring.yaml");
  const raw = parse(readFileSync(path, "utf8"));
  return scoringSchema.parse(raw);
}

export function getFactorProfile(
  config: ScoringConfig,
  instrumentType: "COMMON_STOCK" | "REIT",
) {
  return instrumentType === "REIT"
    ? config.instrument_profiles.reit
    : config.instrument_profiles.default;
}

export function profileName(instrumentType: "COMMON_STOCK" | "REIT"): "default" | "reit" {
  return instrumentType === "REIT" ? "reit" : "default";
}
