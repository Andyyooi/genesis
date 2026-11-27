import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { compareHoldingPublications, loadHoldingPublicationChanges } from "@/lib/holding-publication-changes";

vi.mock("@/fair-value/load-run", () => ({
  loadFairValueRunById: (_db: unknown, id: number) => ({ id }),
}));
vi.mock("@/lib/fair-range", () => ({
  fairRangeHeadline: (row: { id: number } | null) => row ? { available: true, low: row.id, high: row.id + 1 } : { available: false },
}));

const previous = { score: 65.1, range: { low: 2, high: 3 }, asOf: "2026-11-25" };
const current = { score: 70.1, range: { low: 2, high: 3.5 }, asOf: "2026-11-26T10:00:00Z" };

describe("owned stock publication changes", () => {
  it("reports changes at the displayed precision, not noise or missing values", () => {
    expect(compareHoldingPublications(previous, current)).toEqual([
      { kind: "score-changed", title: "Research score changed", why: "65/100 → 70/100", date: "2026-11-26" },
      { kind: "range-moved", title: "Fair range moved", why: "RM\u00a02.00 to RM\u00a03.00 → RM\u00a02.00 to RM\u00a03.50", date: "2026-11-26" },
    ]);
    expect(compareHoldingPublications(previous, { ...current, score: 65.2, range: { low: 2.001, high: 3.001 } })).toEqual([]);
    expect(compareHoldingPublications(previous, { ...current, score: null, range: null })).toEqual([]);
  });

  it("uses each publication’s saved score and only fair valuations available by its timestamp", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE market_scan_runs (id INTEGER, as_of TEXT, summary_json TEXT);
        CREATE TABLE market_scan_rows (run_id INTEGER, instrument_id INTEGER, payload_json TEXT);
        CREATE TABLE fair_value_runs (id INTEGER, instrument_id INTEGER, calculated_at TEXT);
        INSERT INTO market_scan_runs VALUES
          (1, '2026-11-25T10:00:00Z', '{"methodology":"cross-sectional-v2"}'),
          (2, '2026-11-26T10:00:00Z', '{"methodology":"cross-sectional-v2"}');
        INSERT INTO market_scan_rows VALUES (1, 1, '{"researchScore":65}'), (2, 1, '{"researchScore":70}'), (2, 2, '{"researchScore":90}');
        INSERT INTO fair_value_runs VALUES (1, 1, '2026-11-25T09:59:00Z'), (2, 1, '2026-11-26T09:59:00Z'), (3, 1, '2026-11-26T10:01:00Z');
      `);
      const changes = loadHoldingPublicationChanges(db);
      expect(changes(1)).toEqual([
        expect.objectContaining({ kind: "score-changed", why: "65/100 → 70/100" }),
        expect.objectContaining({ kind: "range-moved", why: "RM\u00a01.00 to RM\u00a02.00 → RM\u00a02.00 to RM\u00a03.00" }),
      ]);
      expect(changes(2)).toEqual([]);
      db.exec("UPDATE market_scan_runs SET summary_json = '{}' WHERE id = 1");
      expect(loadHoldingPublicationChanges(db)(1)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
