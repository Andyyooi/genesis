import { getSqlite } from "@/db/client";
import { offsetDays, type DividendCoverage, type DividendEvent } from "@/lib/dividend-yield";

type CoverageRow = { symbol: string; from: string; through: string };
export type YahooDividendCoverage = Omit<DividendCoverage, "events"> & {
  symbol: string;
  currency: string;
  events: (DividendEvent & { sourceId: string })[];
};

export function loadDividendDates(instrumentId: number): CoverageRow | undefined {
  return getSqlite().prepare(`SELECT yahoo_symbol AS symbol, covered_from AS "from", covered_through AS through
    FROM dividend_coverage WHERE instrument_id = ?`).get(instrumentId) as CoverageRow | undefined;
}

export function loadDividendCoverage(instrumentId: number): DividendCoverage | null {
  const coverage = loadDividendDates(instrumentId);
  if (!coverage) return null;
  const events = getSqlite().prepare("SELECT ex_date AS exDate, amount FROM cash_dividends WHERE instrument_id = ? AND source = 'yahoo'")
    .all(instrumentId) as DividendEvent[];
  return { ...coverage, events };
}

// Called in the price write transaction. Replace overlapping observations so corrections are not counted twice.
export function saveDividendCoverage(instrumentId: number, fetched: YahooDividendCoverage, retrievedAt: string) {
  const db = getSqlite();
  const saved = loadDividendDates(instrumentId);
  const sameSymbol = saved?.symbol === fetched.symbol;
  if (sameSymbol && fetched.through < offsetDays(saved.from, -1)) return;
  const connected = sameSymbol && fetched.from <= offsetDays(saved.through, 1);
  if (connected) {
    db.prepare("DELETE FROM cash_dividends WHERE instrument_id = ? AND source = 'yahoo' AND ex_date BETWEEN ? AND ?")
      .run(instrumentId, fetched.from, fetched.through);
  } else {
    db.prepare("DELETE FROM cash_dividends WHERE instrument_id = ? AND source = 'yahoo'").run(instrumentId);
  }
  const insert = db.prepare(`INSERT INTO cash_dividends (instrument_id, source, source_id, ex_date, amount, retrieved_at)
    VALUES (?, 'yahoo', ?, ?, ?, ?) ON CONFLICT (instrument_id, source, source_id)
    DO UPDATE SET ex_date = excluded.ex_date, amount = excluded.amount, retrieved_at = excluded.retrieved_at`);
  for (const event of fetched.events) insert.run(instrumentId, event.sourceId, event.exDate, event.amount, retrievedAt);
  const from = connected && saved.from < fetched.from ? saved.from : fetched.from;
  const through = connected && saved.through > fetched.through ? saved.through : fetched.through;
  db.prepare(`INSERT INTO dividend_coverage VALUES (?, ?, ?, ?) ON CONFLICT (instrument_id) DO UPDATE SET
    yahoo_symbol = excluded.yahoo_symbol, covered_from = excluded.covered_from, covered_through = excluded.covered_through`)
    .run(instrumentId, fetched.symbol, from, through);
}
