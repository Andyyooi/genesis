import { describe, expect, it } from "vitest";
import { validateRefreshStages } from "@/refresh/validate-publication";

const start = "2026-10-01T10:00:00Z";
const rows = ["prices", "fundamentals", "fair_value"].map((dataset) => ({ dataset, status: "SUCCESS", failed_count: 0, started_at: start }));
describe("Actions publication validation", () => {
  it("allows at most 5% genuine fundamentals misses, never source outages or other partial stages", () => {
    const stages = (failed_count: number, attempted_count = 100) => rows.map((r) => r.dataset === "fundamentals" ? { ...r, status: "PARTIAL", failed_count, attempted_count } : r);
    expect(() => validateRefreshStages(stages(5), start)).not.toThrow();
    expect(() => validateRefreshStages(stages(6), start)).toThrow(/fundamentals/);
    expect(() => validateRefreshStages(stages(1, 0), start)).toThrow(/fundamentals/);
    expect(() => validateRefreshStages(stages(100), start)).toThrow(/fundamentals/);
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
