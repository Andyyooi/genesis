import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
};

function sqlitePath() {
  return join(process.cwd(), "data", "sqlite", "research.db");
}

function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE,
      bursa_code TEXT,
      yahoo_ticker TEXT,
      name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      listing_board TEXT,
      instrument_type TEXT NOT NULL,
      pn17 INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'MYR',
      shariah_compliant INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_bars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL REFERENCES instruments(id),
      bar_date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL,
      as_of TEXT,
      source TEXT NOT NULL,
      adjusted INTEGER NOT NULL DEFAULT 0,
      retrieved_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS price_bars_instrument_date_source
      ON price_bars (instrument_id, bar_date, source);

    CREATE TABLE IF NOT EXISTS financial_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL REFERENCES instruments(id),
      fiscal_year INTEGER,
      fiscal_quarter INTEGER,
      period_end TEXT NOT NULL,
      available_at TEXT,
      retrieved_at TEXT NOT NULL,
      statement_type TEXT NOT NULL,
      source TEXT NOT NULL,
      actual_or_estimate TEXT NOT NULL DEFAULT 'actual',
      line_items_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS financial_periods_unique
      ON financial_periods (instrument_id, period_end, statement_type, source);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER REFERENCES instruments(id),
      occurred_at TEXT,
      available_at TEXT,
      source TEXT,
      source_url TEXT,
      headline TEXT,
      excerpt TEXT,
      classification TEXT,
      relevance_note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS events_unique
      ON events (instrument_id, occurred_at, source, headline);

    CREATE TABLE IF NOT EXISTS ingest_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      summary_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS score_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL REFERENCES instruments(id),
      as_of TEXT NOT NULL,
      config_hash TEXT,
      instrument_profile TEXT,
      research_score REAL,
      valuation_score REAL,
      category_scores_json TEXT,
      coverage_json TEXT,
      data_confidence TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL REFERENCES instruments(id),
      ticker TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      title TEXT NOT NULL,
      why TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      href TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS alerts_unique
      ON alerts (instrument_id, rule_id, fingerprint);

    CREATE TABLE IF NOT EXISTS alert_state (
      instrument_id INTEGER PRIMARY KEY REFERENCES instruments(id),
      last_research_score REAL,
      last_health_score REAL,
      last_concern_ids_json TEXT NOT NULL DEFAULT '[]',
      last_list_ids_json TEXT NOT NULL DEFAULT '[]',
      last_event_keys_json TEXT NOT NULL DEFAULT '[]',
      last_close REAL,
      last_close_date TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ticker TEXT,
      yahoo_ticker TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_scan_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES market_scan_runs(id),
      instrument_id INTEGER NOT NULL REFERENCES instruments(id),
      ticker TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  addColumn(sqlite, "instruments", "watchlist", "INTEGER NOT NULL DEFAULT 0");
  addColumn(sqlite, "instruments", "listing_status", "TEXT NOT NULL DEFAULT 'listed'");
  addColumn(sqlite, "instruments", "universe_source", "TEXT");
  addColumn(sqlite, "instruments", "universe_synced_at", "TEXT");
  addColumn(sqlite, "price_bars", "adj_close", "REAL");
  addColumn(sqlite, "score_runs", "data_confidence", "TEXT");
  addColumn(sqlite, "ingest_failures", "failure_code", "TEXT");
  sqlite.exec(
    "UPDATE instruments SET watchlist = 1 WHERE watchlist IS NULL OR (watchlist = 0 AND universe_source IS NULL)",
  );

  const eventCols = sqlite.pragma("table_info(events)") as { name: string }[];
  if (eventCols.length && !eventCols.some((col) => col.name === "relevance_note")) {
    sqlite.exec("ALTER TABLE events ADD COLUMN relevance_note TEXT");
  }
}

function addColumn(sqlite: Database.Database, table: string, name: string, ddl: string) {
  const cols = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  if (cols.length && !cols.some((col) => col.name === name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

export function getDb() {
  if (!globalForDb.sqlite) {
    mkdirSync(join(process.cwd(), "data", "sqlite"), { recursive: true });
    const sqlite = new Database(sqlitePath());
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    ensureSchema(sqlite);
    globalForDb.sqlite = sqlite;
  }
  return drizzle(globalForDb.sqlite, { schema });
}
