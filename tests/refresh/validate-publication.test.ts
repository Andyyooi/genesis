import { describe, expect, it } from "vitest";
import { validateRefreshStages } from "@/refresh/validate-publication";

const start = "2026-10-01T10:00:00Z";
const rows = ["prices", "fundamentals", "fair_value"].map((dataset) => ({ dataset, status: "SUCCESS", failed_count: 0, started_at: start, requested_succeeded_count: 100 }));
describe("Actions publication validation", () => {
  it.each(["prices", "fundamentals"])("bases %s tolerance on actual requested outcomes, never the skipped universe", (dataset) => {
    const stages = (succeeded: number, failed_count: number) => rows.map((r) => r.dataset === dataset ? { ...r, status: "PARTIAL", failed_count, requested_succeeded_count: succeeded, attempted_count: 1000 } : r);
    expect(() => validateRefreshStages(stages(95, 5), start)).not.toThrow();
    expect(() => validateRefreshStages(stages(94, 6), start)).toThrow(dataset);
    expect(() => validateRefreshStages(stages(0, 10), start)).toThrow(dataset);
    expect(() => validateRefreshStages(stages(1, 1), start)).toThrow(dataset);
    expect(() => validateRefreshStages(stages(0, 0), start)).toThrow(dataset);
  });
  it("allows all-skipped fundamentals but fails closed on missing or invalid request counts", () => {
    expect(() => validateRefreshStages(rows.map((r) => r.dataset === "fundamentals" ? { ...r, status: "UNCHANGED", requested_succeeded_count: 0 } : r), start)).not.toThrow();
    for (const count of [undefined, null, -1, NaN, 1.5]) {
      expect(() => validateRefreshStages(rows.map((r) => ({ ...r, requested_succeeded_count: count })), start)).toThrow();
    }
  });
  it("accepts completed refreshes including unavailable fair values, but not absent stages", () => {
    expect(() => validateRefreshStages(rows, start)).not.toThrow();
    expect(() => validateRefreshStages(rows.map((r) => r.dataset === "prices" ? r : { ...r, status: "NO_DATA" }), start)).not.toThrow();
    expect(() => validateRefreshStages(rows.map((r) => ({ ...r, status: "NO_DATA" })), start)).toThrow(/prices/);
    expect(() => validateRefreshStages([], start)).toThrow(/missing/);
    expect(() => validateRefreshStages(rows, "bad")).toThrow(/REFRESH_STARTED_AT/);
  });
  it.each(["PARTIAL", "SOURCE_FAILED", "NO_SOURCE"])("rejects %s even when the daily CLI exits zero", (status) => {
    expect(() => validateRefreshStages(rows.map((r) => r.dataset === "fair_value" ? { ...r, status } : r), start)).toThrow(/fair_value/);
  });
  it("rejects failed counts, old stages and invalid dates", () => {
    expect(() => validateRefreshStages(rows.map((r) => ({ ...r, failed_count: 1 })), start)).toThrow();
    expect(() => validateRefreshStages(rows, "2026-10-02T00:00:00Z")).toThrow();
    expect(() => validateRefreshStages(rows.map((r) => ({ ...r, started_at: "bad" })), start)).toThrow();
  });
});
