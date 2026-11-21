import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  classifyResearchProfile,
  factorSetForProfile,
  type ResearchProfile,
  type ResearchProfileRules,
} from "@/research/profiles";

export const CATEGORY_KEYS = [
  "valuation",
  "quality",
  "financial_health",
  "growth",
  "momentum",
  "low_volatility",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const factorSchema = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive(),
  direction: z.enum(["higher_better", "lower_better"]),
  explanation: z.string(),
});

const factorSetsSchema = z.object({
  valuation: z.array(factorSchema),
  quality: z.array(factorSchema),
  financial_health: z.array(factorSchema),
  growth: z.array(factorSchema),
  momentum: z.array(factorSchema),
  low_volatility: z.array(factorSchema),
});

const categoryWeightsSchema = z.object({
  valuation: z.number().nonnegative(), quality: z.number().nonnegative(),
  financial_health: z.number().nonnegative(), growth: z.number().nonnegative(),
  momentum: z.number().nonnegative(), low_volatility: z.number().nonnegative(),
});

const instrumentProfileSchema = z.object({
  description: z.string(),
  category_weights: categoryWeightsSchema.optional(),
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
    category_weights: categoryWeightsSchema,
    reporting_lag_months: z.number().int().min(0).default(4),
    growth_years: z.number().int().positive().default(3),
    consistency: z.object({ revenue_break_ratio: z.number().positive().max(1), pat_stability_tolerance: z.number().nonnegative(), eps_scale_tolerance: z.number().min(1) }),
    confidence: z.object({ high_coverage: z.number().min(0).max(1), medium_coverage: z.number().min(0).max(1), high_max_age_months: z.number().positive(), medium_max_age_months: z.number().positive() }),
    ranking: z.object({ sector_min_names: z.number().int().min(2), sector_blend: z.number().min(0).max(1) }),
    eligibility: z.object({ min_median_traded_value: z.number().nonnegative(), min_price_days: z.number().int().positive(), min_coverage: z.number().min(0).max(1) }),
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
    research_profile_rules: z
      .object({
        bank_industry_includes: z.array(z.string()).default(["banks"]),
        other_financial_industry_includes: z.array(z.string()).default([
          "insurance",
          "takaful",
          "asset management",
          "capital markets",
          "credit services",
          "financial data",
          "stock exchanges",
        ]),
        bank_tickers: z.array(z.string()).default(["MAYBANK", "CIMB", "PBBANK"]),
      })
      .default({
        bank_industry_includes: ["banks"],
        other_financial_industry_includes: [
          "insurance",
          "takaful",
          "asset management",
          "capital markets",
          "credit services",
          "financial data",
          "stock exchanges",
        ],
        bank_tickers: ["MAYBANK", "CIMB", "PBBANK"],
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
      const weights = value.instrument_profiles[profileName].category_weights;
      if (weights && Object.values(weights).reduce((a, b) => a + b, 0) !== 100) {
        ctx.addIssue({ code: "custom", message: `${profileName} category weights must sum to 100` });
      }
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

export function profileRulesFromConfig(config: ScoringConfig): ResearchProfileRules {
  const rules = config.research_profile_rules;
  return {
    bankIndustryIncludes: rules.bank_industry_includes,
    otherFinancialIndustryIncludes: rules.other_financial_industry_includes,
    bankTickers: rules.bank_tickers.map((t) => t.toUpperCase()),
  };
}

/** @deprecated Explicit bank tickers now live in scoring.yaml research_profile_rules.bank_tickers */
export const BANK_OVERLAY_TICKERS = new Set(["MAYBANK", "CIMB", "PBBANK"]);

export type ScoringProfileName = "default" | "reit" | "bank";

export function resolveResearchProfile(
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null; explicit?: ResearchProfile | null },
  config?: ScoringConfig,
): ReturnType<typeof classifyResearchProfile> {
  const rules = config ? profileRulesFromConfig(config) : undefined;
  return classifyResearchProfile({
    instrumentType,
    ticker,
    sector: hints?.sector,
    industry: hints?.industry,
    explicit: hints?.explicit,
    rules,
  });
}

export function resolveScoringProfile(
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null; explicit?: ResearchProfile | null },
  config?: ScoringConfig,
): ScoringProfileName {
  return resolveResearchProfile(instrumentType, ticker, hints, config).factorSet;
}

export function getFactorProfile(
  config: ScoringConfig,
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null; explicit?: ResearchProfile | null },
) {
  const key = resolveScoringProfile(instrumentType, ticker, hints, config);
  return config.instrument_profiles[key];
}

export function profileName(
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null; explicit?: ResearchProfile | null },
  config?: ScoringConfig,
): ScoringProfileName {
  return resolveScoringProfile(instrumentType, ticker, hints, config);
}

export { factorSetForProfile };
