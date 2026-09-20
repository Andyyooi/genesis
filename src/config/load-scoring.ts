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
    alerts: z
      .object({
        score_delta: z.number().positive(),
        price_move_1d: z.number().positive(),
        price_move_5d: z.number().positive(),
        health_delta: z.number().positive(),
      })
      .default({
        score_delta: 5,
        price_move_1d: 0.05,
        price_move_5d: 0.08,
        health_delta: 8,
      }),
    concerns: z.object({
      apply_score_penalty: z.boolean(),
      rules: z.array(concernRuleSchema),
    }),
    instrument_profiles: z.object({
      default: instrumentProfileSchema,
      reit: instrumentProfileSchema,
      bank: instrumentProfileSchema,
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
    for (const profileName of ["default", "reit", "bank"] as const) {
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

export const BANK_OVERLAY_TICKERS = new Set(["MAYBANK", "CIMB", "PBBANK"]);

export type ScoringProfileName = "default" | "reit" | "bank";

export function resolveScoringProfile(
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null },
): ScoringProfileName {
  if (instrumentType === "REIT") return "reit";
  if (ticker && BANK_OVERLAY_TICKERS.has(ticker.toUpperCase())) return "bank";
  const industry = (hints?.industry ?? "").toLowerCase();
  const sector = (hints?.sector ?? "").toLowerCase();
  if (industry.includes("bank")) return "bank";
  if (sector.includes("financial") && industry.includes("bank")) return "bank";
  return "default";
}

export function getFactorProfile(
  config: ScoringConfig,
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null },
) {
  return config.instrument_profiles[resolveScoringProfile(instrumentType, ticker, hints)];
}

export function profileName(
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null },
): ScoringProfileName {
  return resolveScoringProfile(instrumentType, ticker, hints);
}
