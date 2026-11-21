import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { available } from "@/metrics/types";
import { scoreUniverse } from "@/scoring/score";
import { formatCoverageSummary } from "@/scoring/confidence";
import type { ResearchProfile } from "@/research/profiles";

const config = loadScoringConfig();
const all = Object.values(config.instrument_profiles.default.factor_sets).flat().map((f) => available(f.metric, f.label, 1, "ratio", "", [], "2025-12-31"));
function score(count: number, periodEnd: string | null) {
  return scoreUniverse([{ config, ticker: "TEST", instrumentType: "COMMON_STOCK", metrics: all.slice(0, count), asOf: "2026-09-25", latestAnnual: periodEnd ? { periodEnd, availableAt: "2026-09-24" } : null }]).get("TEST")!;
}

describe("one data confidence label", () => {
  const structuralMetrics = ["gross_profitability", "net_debt_to_ebitda", "interest_coverage"];
  function company(researchProfile: ResearchProfile, reported: string[] = []) {
    const metrics = all.filter((m) => !structuralMetrics.includes(m.id) || reported.includes(m.id));
    return scoreUniverse([{ config, ticker: "TEST", researchProfile, instrumentType: "COMMON_STOCK", metrics, asOf: "2026-09-25", latestAnnual: { periodEnd: "2025-12-31", availableAt: "2026-09-24" } }]).get("TEST")!;
  }

  it("excludes unavailable structural metrics for insurers without changing scores or weights", () => {
    const insurer = company("OTHER_FINANCIAL");
    const general = company("GENERAL");
    expect(insurer.dataCoverage).toMatchObject({ expected: 11, available: 11, unavailable: 0, notApplicable: 3, coverageRatio: 1 });
    expect(insurer.dataConfidence.level).toBe("HIGH");
    expect(formatCoverageSummary(insurer.dataCoverage)).toBe("Coverage 100% (11 of 11 factors that apply; 3 don't apply to this kind of company). Missing evidence is excluded, never zero.");
    expect(insurer.categories).toEqual(general.categories);
    expect(insurer.researchScore).toBe(general.researchScore);
  });

  it("still counts a structural metric when an insurer reports it", () => {
    expect(company("OTHER_FINANCIAL", ["interest_coverage"]).dataCoverage).toMatchObject({ expected: 12, available: 12, unavailable: 0, notApplicable: 2, coverageRatio: 1 });
    expect(company("OTHER_FINANCIAL", structuralMetrics).dataCoverage).toMatchObject({ expected: 14, available: 14, notApplicable: 0, coverageRatio: 1 });
  });

  it("keeps empty insurer evidence at zero coverage rather than manufacturing availability", () => {
    const result = scoreUniverse([{ config, ticker: "EMPTY", researchProfile: "OTHER_FINANCIAL", instrumentType: "COMMON_STOCK", metrics: [], asOf: "2026-09-25" }]).get("EMPTY")!;
    expect(result.dataCoverage).toMatchObject({ expected: 11, available: 0, unavailable: 11, notApplicable: 3, coverageRatio: 0 });
    expect(result.dataConfidence.level).toBe("LOW");
  });

  it("keeps missing structural metrics in GENERAL coverage and preserves legacy wording", () => {
    const general = company("GENERAL");
    expect(general.dataCoverage).toMatchObject({ expected: 14, available: 11, unavailable: 3, notApplicable: 0, coverageRatio: 11 / 14 });
    expect(general.dataConfidence.level).toBe("MEDIUM");
    const { notApplicable, ...legacy } = general.dataCoverage;
    expect(notApplicable).toBe(0);
    expect(formatCoverageSummary(legacy)).toBe(formatCoverageSummary(general.dataCoverage));
    expect(formatCoverageSummary(legacy)).toBe("Coverage 79% (11 of 14 factors). Missing evidence is excluded, never zero.");
  });

  it("uses coverage and accounts age, not magnitude of score or download/publication time", () => {
    const fresh = score(all.length, "2025-12-31");
    expect(fresh.dataConfidence.level).toBe("HIGH");
    expect(score(7, "2025-12-31").dataConfidence.level).toBe("MEDIUM");
    expect(score(1, "2025-12-31").dataConfidence.level).toBe("LOW");
    const old = score(all.length, "2021-12-31");
    expect(old.dataConfidence.level).toBe("LOW");
    expect(old.researchScore).toBe(fresh.researchScore);
    expect(score(all.length, null).dataConfidence.level).toBe("LOW");
    expect(score(0, null).researchScore).toBeNull();
    expect(score(0, null).dataCoverage.available).toBe(0);
  });
});
