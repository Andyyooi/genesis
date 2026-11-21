import { describe, expect, it } from "vitest";
import { loadScoringConfig } from "@/config/load-scoring";
import { available } from "@/metrics/types";
import { scoreUniverse } from "@/scoring/score";

const config = loadScoringConfig();
const all = Object.values(config.instrument_profiles.default.factor_sets).flat().map((f) => available(f.metric, f.label, 1, "ratio", "", [], "2025-12-31"));
function score(count: number, periodEnd: string | null) {
  return scoreUniverse([{ config, ticker: "TEST", instrumentType: "COMMON_STOCK", metrics: all.slice(0, count), asOf: "2026-09-25", latestAnnual: periodEnd ? { periodEnd, availableAt: "2026-09-24" } : null }]).get("TEST")!;
}

describe("one data confidence label", () => {
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
