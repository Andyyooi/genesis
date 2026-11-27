import type Database from "better-sqlite3";
import { loadFairValueRunById } from "@/fair-value/load-run";
import { fairRangeHeadline } from "@/lib/fair-range";
import { formatFairRangeBounds } from "@/lib/format-myr";
import { formatScore100 } from "@/lib/research-copy";
import type { HoldingSignal } from "@/lib/holding-signals";

type Range = { low: number; high: number };
type Observation = { score: number | null; range: Range | null; asOf: string };

export function compareHoldingPublications(previous: Observation, current: Observation): HoldingSignal[] {
  const signals: HoldingSignal[] = [];
  const date = current.asOf.slice(0, 10);
  const before = formatScore100(previous.score);
  const after = formatScore100(current.score);
  if (Number.isFinite(previous.score) && Number.isFinite(current.score) && before !== after) {
    signals.push({ kind: "score-changed", title: "Research score changed", why: `${before} → ${after}`, date });
  }
  if (previous.range && current.range) {
    const before = formatFairRangeBounds(previous.range);
    const after = formatFairRangeBounds(current.range);
    if (before !== after) signals.push({ kind: "range-moved", title: "Fair range moved", why: `${before} → ${after}`, date });
  }
  return signals;
}

export function loadHoldingPublicationChanges(sqlite: Database.Database) {
  const publications = sqlite.prepare(`
    SELECT id, as_of AS asOf, json_extract(summary_json, '$.methodology') AS methodology
    FROM market_scan_runs ORDER BY id DESC LIMIT 2
  `).all() as { id: number; asOf: string; methodology: string | null }[];
  const [current, previous] = publications;
  if (!current || !previous || publications.some(run => run.methodology !== "cross-sectional-v2")) return () => [];

  const scoreFor = sqlite.prepare("SELECT json_extract(payload_json, '$.researchScore') AS score FROM market_scan_rows WHERE run_id = ? AND instrument_id = ?");
  const rangeFor = sqlite.prepare("SELECT id FROM fair_value_runs WHERE instrument_id = ? AND calculated_at <= ? ORDER BY id DESC LIMIT 1");
  function observation(run: typeof current, instrumentId: number): Observation | null {
    const row = scoreFor.get(run.id, instrumentId) as { score: number | null } | undefined;
    if (!row) return null;
    const valuation = rangeFor.get(instrumentId, run.asOf) as { id: number } | undefined;
    const range = fairRangeHeadline(valuation ? loadFairValueRunById(sqlite, valuation.id) : null, null);
    return { asOf: run.asOf, score: row.score, range: range.available ? range : null };
  }
  return (instrumentId: number) => {
    const before = observation(previous, instrumentId);
    const after = observation(current, instrumentId);
    return before && after ? compareHoldingPublications(before, after) : [];
  };
}
