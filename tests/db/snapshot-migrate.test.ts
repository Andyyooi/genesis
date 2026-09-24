import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrateSqliteSchema } from "@/db/client";

describe("snapshot schema migration", () => {
  it("adds Phase 16 event columns to an older events table", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE instruments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        instrument_type TEXT NOT NULL,
        pn17 INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'MYR',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id INTEGER REFERENCES instruments(id),
        occurred_at TEXT,
        available_at TEXT,
        source TEXT,
        source_url TEXT,
        headline TEXT,
        excerpt TEXT,
        classification TEXT,
        created_at TEXT NOT NULL
      );
    `);
    migrateSqliteSchema(sqlite);
    const cols = (sqlite.pragma("table_info(events)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("published_at");
    expect(cols).toContain("retrieved_at");
    expect(cols).toContain("dedupe_key");
    expect(cols).toContain("event_type");
    // Selecting the new column must not throw.
    expect(() => sqlite.prepare("SELECT published_at FROM events").all()).not.toThrow();
    sqlite.close();
  });

  it("creates refresh_runs table via migrateSqliteSchema", () => {
    const sqlite = new Database(":memory:");
    migrateSqliteSchema(sqlite);
    const tables = (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("refresh_runs");
    expect(() =>
      sqlite
        .prepare(
          "SELECT run_id, dataset, source, status, last_successful_at FROM refresh_runs LIMIT 1",
        )
        .all(),
    ).not.toThrow();
    sqlite.close();
  });
});
