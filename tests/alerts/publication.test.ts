import { describe, expect, it } from "vitest";
import { evaluatePublicationAlerts, type AlertCompany, type AlertPublication } from "@/alerts/publication";
import { loadScoringConfig } from "@/config/load-scoring";

function company(overrides: Partial<AlertCompany> = {}): AlertCompany {
  return { instrumentId: 1, ticker: "TEST", researchScore: 50, eligible: true, exclusionReasons: [], lastTrade: "2026-11-20", fairValueSafety: "CLEAR", ...overrides };
}

function publication(rows: AlertCompany[], id = 1): AlertPublication {
  return { id, asOf: id === 1 ? "2026-11-18T12:00:00.000Z" : "2026-11-21T12:00:00.000Z", priceDate: "2026-11-20", rows };
}

describe("published-run change alerts", () => {
  it.each([[54.99, 5, []], [55, 5, ["research_score_up"]], [45, 5, ["research_score_down"]], [55, 6, []]] as const)("applies the configured threshold inclusively: %s, %s", (score, threshold, rules) => {
    const result = evaluatePublicationAlerts(publication([company()]), publication([company({ researchScore: score })], 2), threshold);
    expect(result.map((row) => row.ruleId)).toEqual(rules);
  });

  it("does not create changes without a prior publication", () => {
    expect(evaluatePublicationAlerts(null, publication([company({ exclusionReasons: ["Stored PN17 / warning flag is set."], fairValueSafety: "FLAGGED" })], 2), 5)).toEqual([]);
  });

  it("does not invent a previous score or safety flag when values are missing", () => {
    const before = company({ researchScore: null, eligible: false, fairValueSafety: null });
    const after = company({ eligible: false, fairValueSafety: "FLAGGED" });
    expect(evaluatePublicationAlerts(publication([before]), publication([after], 2), 5)).toEqual([]);
  });

  it("reports entering and leaving the same top 15 eligible ranking used by picks", () => {
    const before = Array.from({ length: 16 }, (_, i) => company({ ticker: `T${String(i).padStart(2, "0")}`, researchScore: 100 - i }));
    const after = before.map((row) => row.ticker === "T15" ? { ...row, researchScore: 110 } : row);
    const alerts = evaluatePublicationAlerts(publication(before), publication(after, 2), 1000);
    expect(alerts.map((row) => [row.ticker, row.ruleId])).toEqual([["T14", "top_pick_left"], ["T15", "top_pick_entered"]]);
  });

  it("reports a pick leaving the listed universe rather than inventing a new score", () => {
    const result = evaluatePublicationAlerts(publication([company()]), publication([], 2), 5);
    expect(result.map((row) => row.ruleId)).toEqual(["top_pick_left"]);
  });

  it("does not treat numeric changes to an existing exclusion as new reasons", () => {
    const before = company({ eligible: false, exclusionReasons: ["Median daily traded value RM 10000 is below RM 100000.", "Only 100 price days; 200 required."] });
    const after = company({ eligible: false, exclusionReasons: ["Median daily traded value RM 9000 is below RM 100000.", "Only 101 price days; 200 required.", "Stored PN17 / warning flag is set."] });
    const result = evaluatePublicationAlerts(publication([before]), publication([after], 2), 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ruleId: "new_exclusion_reason", evidence: { reasons: ["Stored PN17 / warning flag is set."] } });
  });

  it("reports newly illiquid names and genuine persisted safety changes", () => {
    const result = evaluatePublicationAlerts(publication([company()]), publication([company({ eligible: false, exclusionReasons: ["Median daily traded value RM 50000 is below RM 100000."], fairValueSafety: "FLAGGED" })], 2), 5);
    expect(result.map((row) => row.ruleId).sort()).toEqual(["fair_value_safety_changed", "new_exclusion_reason", "top_pick_left"]);
    for (const alert of result) {
      expect(alert.why).toContain("previous run 2026-11-18 → this run's price date 2026-11-20");
      expect(alert.evidence).toMatchObject({ previousRunId: 1, publicationRunId: 2, publishedAt: "2026-11-21T12:00:00.000Z" });
    }
  });

  it("does not invent dates when the universe has no usable price date", () => {
    const current = { ...publication([company({ researchScore: 60 })], 2), priceDate: null };
    expect(evaluatePublicationAlerts(publication([company()]), current, 5)[0].why).toContain("price date unavailable");
  });

  it("does not generate alerts for unchanged publications", () => {
    expect(evaluatePublicationAlerts(publication([company()]), publication([company()], 2), 5)).toEqual([]);
  });

  it("uses a meaningful default threshold and ignores moves in excluded non-picks", () => {
    const config = loadScoringConfig().alerts;
    expect(config.score_delta).toBe(15);
    const before = company({ eligible: false, researchScore: 10 });
    const after = { ...before, researchScore: 80 };
    expect(evaluatePublicationAlerts(publication([before]), publication([after], 2), config.score_delta)).toEqual([]);
    const policy = { ...config.publication, score_eligible_only: false };
    expect(evaluatePublicationAlerts(publication([before]), publication([after], 2), config.score_delta, policy).map((row) => row.ruleId)).toEqual(["research_score_up"]);
    expect(evaluatePublicationAlerts(publication([company()]), publication([company({ researchScore: 64.99 })], 2), config.score_delta)).toEqual([]);
  });

  it("keeps meaningful score moves for a former pick that becomes excluded", () => {
    const result = evaluatePublicationAlerts(publication([company()]), publication([company({ eligible: false, researchScore: 20 })], 2), 15);
    expect(result.map((row) => row.ruleId)).toEqual(["top_pick_left", "research_score_down"]);
  });

  it("suppresses routine exclusions outside picks, but always considers new warnings", () => {
    const before = company({ eligible: false });
    const after = { ...before, exclusionReasons: ["Median daily traded value RM 50000 is below RM 100000."] };
    expect(evaluatePublicationAlerts(publication([before]), publication([after], 2), 15)).toEqual([]);
    const policy = { ...loadScoringConfig().alerts.publication, exclusions_top_picks_only: false };
    expect(evaluatePublicationAlerts(publication([before]), publication([after], 2), 15, policy)[0].ruleId).toBe("new_exclusion_reason");
    const warning = { ...after, exclusionReasons: [...after.exclusionReasons, "Stored PN17 / warning flag is set."] };
    const result = evaluatePublicationAlerts(publication([before]), publication([warning], 2), 15);
    expect(result).toHaveLength(1);
    expect(result[0].evidence.reasons).toEqual(["Stored PN17 / warning flag is set."]);
  });

  it("caps each type after ranking the biggest moves, deterministically", () => {
    const before = Array.from({ length: 20 }, (_, i) => company({ ticker: `T${i}`, researchScore: 30 + i }));
    const after = before.map((row, i) => ({ ...row, researchScore: row.researchScore! + 16 + i }));
    const policy = loadScoringConfig().alerts.publication;
    const evaluate = (settings = policy) => evaluatePublicationAlerts(publication(before), publication(after, 2), 15, settings);
    expect(evaluate().map((row) => row.ticker)).toEqual(["T19", "T18", "T17", "T16", "T15"]);
    expect(evaluate({ ...policy, max_per_type: { ...policy.max_per_type, research_score_up: 2 } }).map((row) => row.ticker)).toEqual(["T19", "T18"]);
    expect(evaluate({ ...policy, max_per_type: { ...policy.max_per_type, research_score_up: 0 } })).toEqual([]);
    const reversed = evaluatePublicationAlerts(publication([...before].reverse()), publication([...after].reverse(), 2), 15);
    expect(reversed).toEqual(evaluate());
  });

  it("prioritizes warnings before routine exclusions when applying a cap", () => {
    const before = [company({ ticker: "A" }), company({ ticker: "Z", eligible: false })];
    const after = before.map((row) => ({ ...row, eligible: false, exclusionReasons: [row.ticker === "A" ? "Only 100 price days; 200 required." : "Stored PN17 / warning flag is set."] }));
    const policy = loadScoringConfig().alerts.publication;
    const result = evaluatePublicationAlerts(publication(before), publication(after, 2), 15, { ...policy, max_per_type: { ...policy.max_per_type, new_exclusion_reason: 1 } });
    expect(result.map((row) => [row.ticker, row.ruleId])).toEqual([["Z", "new_exclusion_reason"], ["A", "top_pick_left"]]);
    const reordered = evaluatePublicationAlerts(publication(before), publication(after, 2), 15, { ...policy, priority: ["top_pick_left", "new_exclusion_reason"] });
    expect(reordered[0].ruleId).toBe("top_pick_left");
  });
});
