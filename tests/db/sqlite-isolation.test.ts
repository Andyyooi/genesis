import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getDb, getSqlite, migrateSqliteSchema } from "@/db/client";
import {
  defaultLiveSqlitePath,
  liveSqlitePath,
  resolveSqliteFile,
  targetsLiveResearchDatabase,
} from "@/db/snapshot-file";
import { isCliEntrypoint } from "@/cli/entrypoint";
import { loadFairValueForPage } from "@/fair-value/load-for-page";
import { refreshFairValueUniverse } from "@/refresh/fair-value";
import { dailyRefreshOptionsFromArgv } from "@/refresh/cli";

const PREV_PATH = process.env.BURSA_SQLITE_PATH;
let tempDir = "";

function closeSingleton() {
  const g = globalThis as { sqlite?: { close: () => void } };
  try {
    g.sqlite?.close();
  } catch {
    /* The singleton may already be closed. */
  }
  delete g.sqlite;
}

function removeTempDir(dir: string) {
  if (!dir) return;
  const root = realpathSync(tmpdir());
  const target = realpathSync(dir);
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Refusing to delete a directory outside the temp root: ${target}`);
  }
  if (targetsLiveResearchDatabase(target) || target.includes(`${join("data", "sqlite")}`)) {
    throw new Error(`Refusing to delete the live research database: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

afterEach(() => {
  closeSingleton();
  removeTempDir(tempDir);
  tempDir = "";
  if (PREV_PATH === undefined) delete process.env.BURSA_SQLITE_PATH;
  else process.env.BURSA_SQLITE_PATH = PREV_PATH;
  delete process.env.BURSA_SNAPSHOT_READONLY;
  delete process.env.VERCEL;
});

describe("sqlite test isolation", () => {
  it("opens schema and fair value refresh on an isolated database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "genesis-sqlite-isolation-"));
    const dbPath = join(tempDir, "research.db");
    process.env.BURSA_SQLITE_PATH = dbPath;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    closeSingleton();

    const resolved = resolveSqliteFile();
    expect(resolved.readonly).toBe(false);
    expect(resolve(resolved.path)).toBe(resolve(dbPath));
    expect(targetsLiveResearchDatabase(resolved.path)).toBe(false);

    getDb();
    const opened = getSqlite()
      .prepare("SELECT file FROM pragma_database_list WHERE name = 'main'")
      .get() as { file: string };
    expect(realpathSync(opened.file)).toBe(realpathSync(dbPath));
    expect(targetsLiveResearchDatabase(opened.file)).toBe(false);
    const tables = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((row) => row.name)).toContain("fair_value_runs");

    const report = refreshFairValueUniverse({ asOf: "2026-10-08T00:00:00.000Z" });
    expect(report.attempted).toBe(0);
    expect(report.inserted).toBe(0);
    expect(report.failed).toEqual([]);
    expect(getSqlite().prepare("SELECT COUNT(*) AS n FROM fair_value_runs").get()).toEqual({ n: 0 });

    const memory = new Database(":memory:");
    migrateSqliteSchema(memory);
    const memoryTables = (
      memory.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(memoryTables).toContain("fair_value_runs");
    expect(memoryTables).toContain("refresh_runs");
    memory.close();
  });

  it("rejects the default live database and an explicit live path", () => {
    expect((Database as unknown as { genesisTestGuard?: boolean }).genesisTestGuard).toBe(true);
    delete process.env.BURSA_SQLITE_PATH;
    delete process.env.BURSA_SNAPSHOT_READONLY;
    delete process.env.VERCEL;
    closeSingleton();

    expect(targetsLiveResearchDatabase(liveSqlitePath())).toBe(true);
    expect(targetsLiveResearchDatabase(defaultLiveSqlitePath())).toBe(true);
    expect(() => resolveSqliteFile()).toThrow(/live research database/);
    expect(() => getDb()).toThrow(/live research database/);
    expect(() => loadFairValueForPage("MAYBANK")).toThrow(/live research database/);
    expect(() => new Database(defaultLiveSqlitePath())).toThrow(/live research database/);
    expect(() => new Database(join("data", "sqlite", "research.db"))).toThrow(/live research database/);

    process.env.BURSA_SQLITE_PATH = defaultLiveSqlitePath();
    closeSingleton();
    expect(() => resolveSqliteFile()).toThrow(/live research database/);
    expect(() => getDb()).toThrow(/live research database/);
    expect(() => new Database(process.env.BURSA_SQLITE_PATH)).toThrow(/live research database/);
  });

  it("imports the refresh CLI without starting a refresh", () => {
    const cliPath = resolve("src/refresh/cli.ts");
    expect(isCliEntrypoint(pathToFileURL(realpathSync(cliPath)).href, cliPath)).toBe(true);
    expect(isCliEntrypoint(import.meta.url)).toBe(false);
    expect(dailyRefreshOptionsFromArgv(["--skip-rescore"])).toEqual({ skipRescore: true });
    expect((globalThis as { sqlite?: unknown }).sqlite).toBeUndefined();
  });
});
