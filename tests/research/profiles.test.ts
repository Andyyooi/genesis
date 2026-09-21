import { describe, expect, it } from "vitest";
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { classifyResearchProfile } from "@/research/profiles";

const config = loadScoringConfig();

describe("research profile classification", () => {
  it("assigns BANK from industry or explicit bank tickers, not from the company name string", () => {
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "MAYBANK",
        sector: "Financial Services",
        industry: "Banks - Regional",
      }).profile,
    ).toBe("BANK");
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "CIMB",
        sector: "Financial Services",
        industry: null,
      }).profile,
    ).toBe("BANK");
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "NOTABANK",
        sector: "Financial Services",
        industry: null,
      }).profile,
    ).toBe("UNKNOWN");
  });

  it("uses instrument_type for REITs and GENERAL for industrials/tech", () => {
    expect(
      classifyResearchProfile({ instrumentType: "REIT", ticker: "KLCC", sector: "Real Estate" }).profile,
    ).toBe("REIT");
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "MRDIY",
        sector: "Consumer Products",
        industry: null,
      }).profile,
    ).toBe("GENERAL");
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "INARI",
        sector: "Technology",
        industry: "Semiconductor Equipment & Materials",
      }).profile,
    ).toBe("GENERAL");
  });

  it("labels other financials and unmapped financial industry as UNKNOWN/OTHER_FINANCIAL", () => {
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "TAKAFUL",
        sector: "Financial Services",
        industry: "Insurance - Specialty",
      }).profile,
    ).toBe("OTHER_FINANCIAL");
    expect(
      classifyResearchProfile({
        instrumentType: "COMMON_STOCK",
        ticker: "SCGM",
        sector: "Financial Services",
        industry: "Shell Companies",
      }).profile,
    ).toBe("UNKNOWN");
  });

  it("maps BANK/REIT to factor sets without changing GENERAL YAML", () => {
    expect(resolveResearchProfile("COMMON_STOCK", "MRDIY", {}, config).factorSet).toBe("default");
    expect(resolveResearchProfile("COMMON_STOCK", "MAYBANK", { industry: "Banks - Regional" }, config).factorSet).toBe(
      "bank",
    );
    expect(resolveResearchProfile("REIT", "PAVREIT", {}, config).factorSet).toBe("reit");
    const generalFactors = config.instrument_profiles.default.factor_sets.valuation.map((f) => f.id);
    expect(generalFactors).toEqual(["pe", "dividend_yield"]);
  });
});
