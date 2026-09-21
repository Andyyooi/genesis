import { describe, expect, it } from "vitest";
import {
  classifyInstrumentType,
  shouldExcludeListing,
  tickerFromYahoo,
} from "@/providers/classify-listing";
import { getFactorProfile, loadScoringConfig } from "@/config/load-scoring";

describe("listing classifier", () => {
  it("keeps MAYBANK as common stock and does not treat the code as a warrant", () => {
    expect(shouldExcludeListing("1155.KL", "MAYBANK", "Malayan Banking Berhad")).toBeNull();
    expect(classifyInstrumentType("MAYBANK", "Malayan Banking Berhad")).toBe("COMMON_STOCK");
    expect(tickerFromYahoo("MAYBANK", "1155")).toBe("MAYBANK");
  });

  it("excludes warrants and ETFs", () => {
    expect(shouldExcludeListing("1155WA.KL", "MAYBANK-WA", "Maybank Warrant")).toMatch(/Warrant/);
    expect(shouldExcludeListing("0820EA.KL", "SOME-ETF", "ABC ETF")).toMatch(/ETF/);
    expect(shouldExcludeListing("0800EA.KL", "ABFMY1", "ABF Malaysia Bond Index")).toMatch(/ETF/);
  });

  it("classifies REITs from the name", () => {
    expect(classifyInstrumentType("KLCC", "KLCC Property Holdings Berhad REIT")).toBe("REIT");
    expect(classifyInstrumentType("AXISREIT", "Axis Real Estate Investment Trust")).toBe("REIT");
  });
});

describe("bank overlay is not ingest-hardcoded", () => {
  it("selects bank factors from industry Banks without requiring MAYBANK", () => {
    const config = loadScoringConfig();
    const profile = getFactorProfile(config, "COMMON_STOCK", "SOMEBANK", {
      sector: "Financial Services",
      industry: "Banks—Diversified",
    });
    const metrics = [
      ...profile.factor_sets.valuation,
      ...profile.factor_sets.quality,
      ...profile.factor_sets.financial_health,
    ].map((f) => f.metric);
    expect(metrics).toContain("price_to_book");
    expect(metrics).toContain("roe");
    expect(metrics).not.toContain("fcf");
  });
});
