export const RESEARCH_PROFILES = [
  "GENERAL",
  "BANK",
  "REIT",
  "OTHER_FINANCIAL",
  "UNKNOWN",
] as const;

export type ResearchProfile = (typeof RESEARCH_PROFILES)[number];

export type FactorSetName = "default" | "reit" | "bank";

export type ResearchProfileRules = {
  bankIndustryIncludes: string[];
  otherFinancialIndustryIncludes: string[];
  bankTickers: string[];
};

export const DEFAULT_PROFILE_RULES: ResearchProfileRules = {
  bankIndustryIncludes: ["banks"],
  otherFinancialIndustryIncludes: [
    "insurance",
    "takaful",
    "asset management",
    "capital markets",
    "credit services",
    "financial data",
    "stock exchanges",
  ],
  bankTickers: ["MAYBANK", "CIMB", "PBBANK"],
};

function includesAny(haystack: string, needles: string[]): boolean {
  const text = haystack.toLowerCase();
  return needles.some((needle) => text.includes(needle.toLowerCase()));
}

export function factorSetForProfile(profile: ResearchProfile): FactorSetName {
  if (profile === "REIT") return "reit";
  if (profile === "BANK") return "bank";
  return "default";
}

export function classifyResearchProfile(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  industry?: string | null;
  sector?: string | null;
  ticker?: string | null;
  explicit?: ResearchProfile | null;
  rules?: ResearchProfileRules;
}): { profile: ResearchProfile; reason: string; factorSet: FactorSetName } {
  const rules = args.rules ?? DEFAULT_PROFILE_RULES;
  if (args.explicit && (RESEARCH_PROFILES as readonly string[]).includes(args.explicit)) {
    return {
      profile: args.explicit,
      reason: "Explicit research_profile on the universe row.",
      factorSet: factorSetForProfile(args.explicit),
    };
  }
  if (args.instrumentType === "REIT") {
    return {
      profile: "REIT",
      reason: "instrument_type is REIT (not inferred from the display name at score time).",
      factorSet: "reit",
    };
  }
  const industry = (args.industry ?? "").trim();
  const sector = (args.sector ?? "").trim();
  const ticker = (args.ticker ?? "").trim().toUpperCase();

  if (industry && includesAny(industry, rules.bankIndustryIncludes)) {
    return {
      profile: "BANK",
      reason: `Stored industry “${industry}” matches the bank industry rule.`,
      factorSet: "bank",
    };
  }
  if (ticker && rules.bankTickers.includes(ticker)) {
    return {
      profile: "BANK",
      reason: `Ticker is on the explicit bank list in scoring config (not a name guess).`,
      factorSet: "bank",
    };
  }
  if (industry && includesAny(industry, rules.otherFinancialIndustryIncludes)) {
    return {
      profile: "OTHER_FINANCIAL",
      reason: `Stored industry “${industry}” is financial but not a bank. GENERAL factor set until a dedicated model exists.`,
      factorSet: "default",
    };
  }
  if (/financial/i.test(sector) && !industry) {
    return {
      profile: "UNKNOWN",
      reason: "Sector is Financial Services but industry is missing — not assumed to be a bank.",
      factorSet: "default",
    };
  }
  if (/financial/i.test(sector) && industry) {
    return {
      profile: "UNKNOWN",
      reason: `Sector is financial but industry “${industry}” is not mapped to BANK or OTHER_FINANCIAL.`,
      factorSet: "default",
    };
  }
  return {
    profile: "GENERAL",
    reason: "COMMON_STOCK with no bank/REIT/other-financial industry tag.",
    factorSet: "default",
  };
}
