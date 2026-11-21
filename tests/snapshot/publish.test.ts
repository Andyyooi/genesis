import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { getDb, getSqlite, migrateSqliteSchema } from "@/db/client";
import { snapshotGzPath, targetsLiveResearchDatabase } from "@/db/snapshot-file";
import { runRefreshAndResearch } from "@/refresh/on-demand";
import {
  formatSnapshotReport,
  packSnapshot,
  SnapshotRejected,
  validateSnapshotArtifact,
} from "@/snapshot/publish";

function closeSingleton() {
  const g = globalThis as { sqlite?: { close: () => void } };
  try {
    g.sqlite?.close();
  } catch {
    /* already closed */
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

function seed(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  migrateSqliteSchema(sqlite);
  const now = "2026-10-12T00:00:00.000Z";
  sqlite
    .prepare(
      `INSERT INTO instruments (
         ticker, name, instrument_type, research_profile, pn17, currency, watchlist,
         listing_status, universe_source, created_at, updated_at
       ) VALUES (?, ?, 'COMMON_STOCK', 'BANK', 0, 'MYR', ?, 'listed', ?, ?, ?)`,
    )
    .run("MAYBANK", "Malayan Banking", 1, "universe", now, now);
  sqlite
    .prepare(
      `INSERT INTO instruments (
         ticker, name, instrument_type, research_profile, pn17, currency, watchlist,
         listing_status, universe_source, created_at, updated_at
       ) VALUES (?, ?, 'COMMON_STOCK', 'BANK', 0, 'MYR', ?, 'listed', ?, ?, ?)`,
    )
    .run("CIMB", "CIMB Group", 0, "universe", now, now);
  sqlite
    .prepare(
      `INSERT INTO instruments (
         ticker, name, instrument_type, research_profile, pn17, currency, watchlist,
         listing_status, universe_source, created_at, updated_at
       ) VALUES (?, ?, 'COMMON_STOCK', 'GENERAL', 0, 'MYR', ?, 'listed', NULL, ?, ?)`,
    )
    .run("ORPHAN", "Orphan Co", 0, now, now);
  sqlite
    .prepare(
      `INSERT INTO price_bars (instrument_id, bar_date, close, source, adjusted, retrieved_at)
       VALUES (1, '2026-09-18', 10, 'yahoo', 1, ?)`,
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO price_bars (instrument_id, bar_date, close, source, adjusted, retrieved_at)
       VALUES (1, '9999-99-99', 1, 'yahoo', 1, ?)`,
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO price_bars (instrument_id, bar_date, close, source, adjusted, retrieved_at)
       VALUES (1, '2026-10-12', 11, 'yahoo', 1, ?)`,
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO financial_periods (
         instrument_id, period_end, statement_type, source, actual_or_estimate, retrieved_at
       ) VALUES (1, '2025-12-31', 'annual', 'csv', 'actual', ?)`,
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO score_runs (instrument_id, as_of, research_score, created_at)
       VALUES (1, ?, NULL, ?)`,
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO fair_value_runs (
         instrument_id, ticker, research_profile, model_version, fair_value_base,
         confidence, methods_json, assumptions_json, calculated_at, quality_status
       ) VALUES (1, 'MAYBANK', 'BANK', 'unsupported', NULL, 'LOW', '[]', '{}', ?, 'NO_VALUE')`,
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO fair_value_runs (
         instrument_id, ticker, research_profile, model_version, fair_value_base,
         confidence, methods_json, assumptions_json, calculated_at, quality_status
       ) VALUES (2, 'CIMB', 'BANK', 'bank-relative-v1', 4.5, 'LOW', '[]', '{}', ?, 'CLEAR')`,
    )
    .run(now);
  return sqlite;
}

function incompleteSeed(file: string) {
  const sqlite = new Database(file);
  sqlite.exec(`
    CREATE TABLE instruments (
      id INTEGER PRIMARY KEY,
      ticker TEXT NOT NULL,
      name TEXT NOT NULL,
      watchlist INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE price_bars (
      instrument_id INTEGER NOT NULL,
      bar_date TEXT NOT NULL,
      close REAL,
      source TEXT NOT NULL
    );
    CREATE TABLE financial_periods (
      instrument_id INTEGER NOT NULL,
      period_end TEXT NOT NULL,
      statement_type TEXT NOT NULL
    );
    CREATE TABLE score_runs (
      instrument_id INTEGER NOT NULL,
      research_score REAL
    );
    CREATE TABLE fair_value_runs (
      instrument_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      model_version TEXT NOT NULL,
      fair_value_base REAL
    );
  `);
  sqlite.prepare("INSERT INTO instruments (ticker, name, watchlist) VALUES ('X', 'X', 1)").run();
  return sqlite;
}

function fileMark(file: string) {
  const stat = statSync(file);
  return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
}

describe("snapshot packaging", () => {
  const dirs: string[] = [];
  const previousReadonly = process.env.BURSA_SNAPSHOT_READONLY;
  const previousGz = process.env.BURSA_SNAPSHOT_GZ_PATH;
  const previousSqlite = process.env.BURSA_SQLITE_PATH;

  afterEach(() => {
    closeSingleton();
    if (previousReadonly === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
    else process.env.BURSA_SNAPSHOT_READONLY = previousReadonly;
    if (previousGz === undefined) delete process.env.BURSA_SNAPSHOT_GZ_PATH;
    else process.env.BURSA_SNAPSHOT_GZ_PATH = previousGz;
    if (previousSqlite === undefined) delete process.env.BURSA_SQLITE_PATH;
    else process.env.BURSA_SQLITE_PATH = previousSqlite;
    vi.unstubAllGlobals();
    for (const dir of dirs.splice(0)) removeTempDir(dir);
  });

  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), "genesis-snapshot-test-"));
    dirs.push(dir);
    return dir;
  }

  it("packages a disposable database without changing the source and reads back the same counts", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const dest = join(dir, "candidate.db.gz");
    const current = join(dir, "current.db.gz");
    writeFileSync(current, Buffer.from("previous-snapshot"));
    const sqlite = seed(source);
    const before = fileMark(source);
    const beforeWal = existsSync(`${source}-wal`) ? fileMark(`${source}-wal`) : null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const report = await packSnapshot({
      sourcePath: source,
      destPath: dest,
      currentSnapshotPath: current,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(fileMark(source)).toEqual(before);
    if (beforeWal) expect(fileMark(`${source}-wal`)).toEqual(beforeWal);
    sqlite.close();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.deployed).toBe(false);
    expect(report.stage).toBe("packaged");
    expect(report.artifactValidated).toBe(true);
    expect(report.loaderCompatible).toBe(true);
    expect(report.instrumentCount).toBe(3);
    expect(report.watchlistCount).toBe(1);
    expect(report.effectiveWatchlistCount).toBe(2);
    expect(report.financialPeriodCount).toBe(1);
    expect(report.priceBarCount).toBe(3);
    expect(report.latestPriceDate).toBe("2026-10-12");
    expect(report.latestFinancialPeriod).toBe("2025-12-31");
    expect(report.scoreRunCount).toBe(1);
    expect(report.fairValueRunCount).toBe(2);
    expect(report.unsupportedFairValueCount).toBe(1);
    expect(report.noValueFairValueCount).toBe(1);
    expect(report.artifactBytes).toBeGreaterThan(0);
    expect(report.differsFromCurrent).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/effective watchlist|become watched/i);
    expect(formatSnapshotReport(report)).toContain("Deployed to the website: no");
    expect(formatSnapshotReport(report)).toContain("Loader-compatible: yes");

    const again = join(dir, "again.db.gz");
    const repeated = await packSnapshot({
      sourcePath: source,
      destPath: again,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(repeated.artifactValidated).toBe(true);
    expect(repeated.instrumentCount).toBe(report.instrumentCount);
    expect(repeated.latestPriceDate).toBe(report.latestPriceDate);
    const checked = validateSnapshotArtifact({
      artifactPath: dest,
      sourcePath: source,
      currentSnapshotPath: dest,
    });
    expect(checked.stage).toBe("validated");
    expect(checked.loaderCompatible).toBe(true);
    expect(checked.differsFromCurrent).toBe(false);
    expect(checked.deployed).toBe(false);
  });

  it("opens a packed candidate through the read-only application loader", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const dest = join(dir, "candidate.db.gz");
    seed(source).close();
    await packSnapshot({
      sourcePath: source,
      destPath: dest,
      productionPath: join(dir, "production.db.gz"),
    });

    process.env.BURSA_SNAPSHOT_READONLY = "1";
    process.env.BURSA_SNAPSHOT_GZ_PATH = dest;
    delete process.env.BURSA_SQLITE_PATH;
    closeSingleton();

    getDb();
    const sqlite = getSqlite();
    const instruments = sqlite.prepare("SELECT ticker, watchlist FROM instruments ORDER BY ticker").all() as {
      ticker: string;
      watchlist: number;
    }[];
    expect(instruments.map((row) => row.ticker)).toEqual(["CIMB", "MAYBANK", "ORPHAN"]);
    expect(instruments.find((row) => row.ticker === "MAYBANK")?.watchlist).toBe(1);
    expect(instruments.find((row) => row.ticker === "ORPHAN")?.watchlist).toBe(1);
    expect(instruments.find((row) => row.ticker === "CIMB")?.watchlist).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM price_bars").get()).toEqual({ n: 3 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM financial_periods").get()).toEqual({ n: 1 });
    expect(realpathSync(snapshotGzPath())).toBe(realpathSync(dest));
  });

  it("rejects incomplete schemas that the application loader cannot migrate", async () => {
    const dir = tempDir();
    const source = join(dir, "incomplete.db");
    const dest = join(dir, "out.db.gz");
    incompleteSeed(source).close();
    await expect(
      packSnapshot({ sourcePath: source, destPath: dest, productionPath: join(dir, "production.db.gz") }),
    ).rejects.toThrow(/Application loader cannot migrate/);
    expect(existsSync(dest)).toBe(false);
  });

  it("rejects a corrupt source, a missing table, and a missing watchlist column without replacing an artifact", async () => {
    const dir = tempDir();
    const dest = join(dir, "keep.gz");
    writeFileSync(dest, Buffer.from("keep"));
    const corrupt = join(dir, "corrupt.db");
    writeFileSync(corrupt, "this is not sqlite");
    await expect(
      packSnapshot({ sourcePath: corrupt, destPath: dest, productionPath: join(dir, "production.db.gz") }),
    ).rejects.toBeInstanceOf(SnapshotRejected);
    expect(readFileSync(dest).toString()).toBe("keep");

    const empty = join(dir, "empty.db");
    new Database(empty).close();
    await expect(
      packSnapshot({ sourcePath: empty, destPath: dest, productionPath: join(dir, "production.db.gz") }),
    ).rejects.toThrow(/Missing required table instruments/);
    expect(readFileSync(dest).toString()).toBe("keep");

    const partial = join(dir, "partial.db");
    const sqlite = new Database(partial);
    sqlite.exec(`
      CREATE TABLE instruments (id INTEGER PRIMARY KEY, ticker TEXT, name TEXT, notes TEXT);
      CREATE TABLE price_bars (instrument_id INTEGER, bar_date TEXT, close REAL, source TEXT);
      CREATE TABLE financial_periods (instrument_id INTEGER, period_end TEXT, statement_type TEXT);
      CREATE TABLE score_runs (instrument_id INTEGER, research_score REAL);
      CREATE TABLE fair_value_runs (instrument_id INTEGER, ticker TEXT, model_version TEXT, fair_value_base REAL);
    `);
    sqlite.close();
    await expect(
      packSnapshot({ sourcePath: partial, destPath: dest, productionPath: join(dir, "production.db.gz") }),
    ).rejects.toThrow(/watchlist/);
    expect(readFileSync(dest).toString()).toBe("keep");
  });

  it("does not replace an existing artifact when the output directory cannot be written", async () => {
    const dir = tempDir();
    const nested = join(dir, "locked");
    const source = join(dir, "source.db");
    const dest = join(nested, "candidate.db.gz");
    seed(source).close();
    mkdirSync(nested, { recursive: true });
    writeFileSync(dest, Buffer.from("original"));
    chmodSync(nested, 0o555);
    await expect(
      packSnapshot({ sourcePath: source, destPath: dest, productionPath: join(dir, "production.db.gz") }),
    ).rejects.toBeInstanceOf(SnapshotRejected);
    chmodSync(nested, 0o755);
    expect(readFileSync(dest).toString()).toBe("original");
    expect(existsSync(`${dest}.partial`)).toBe(false);
  });

  it("refuses the production snapshot path unless writing it is explicit", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const production = join(dir, "research.db.gz");
    writeFileSync(production, Buffer.from("live-snapshot"));
    const before = fileMark(production);
    seed(source).close();
    await expect(
      packSnapshot({ sourcePath: source, destPath: production, productionPath: production }),
    ).rejects.toThrow(/Refusing to overwrite the production snapshot/);
    expect(fileMark(production)).toEqual(before);
    expect(readFileSync(production).toString()).toBe("live-snapshot");

    const written = await packSnapshot({
      sourcePath: source,
      destPath: production,
      productionPath: production,
      writeProduction: true,
    });
    expect(written.artifactValidated).toBe(true);
    expect(readFileSync(production).toString()).not.toBe("live-snapshot");
  });

  it("does not touch the committed snapshot when that path is refused", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const committed = snapshotGzPath();
    const before = existsSync(committed) ? fileMark(committed) : null;
    seed(source).close();
    await expect(packSnapshot({ sourcePath: source, destPath: committed })).rejects.toThrow(
      /Refusing to overwrite the production snapshot/,
    );
    expect(existsSync(committed) ? fileMark(committed) : null).toEqual(before);
  });

  it("rejects a candidate that does not match its source and a candidate that is not gzip", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const other = join(dir, "other.db");
    const dest = join(dir, "candidate.db.gz");
    seed(source).close();
    seed(other).close();
    const otherDb = new Database(other);
    otherDb.prepare("DELETE FROM price_bars WHERE bar_date = '2026-10-12'").run();
    otherDb.close();
    const report = await packSnapshot({
      sourcePath: source,
      destPath: dest,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(report.artifactValidated).toBe(true);
    expect(() => validateSnapshotArtifact({ artifactPath: dest, sourcePath: other })).toThrow(
      /price-bar fingerprint/,
    );
    const broken = join(dir, "broken.gz");
    writeFileSync(broken, Buffer.from("not gzip"));
    expect(() => validateSnapshotArtifact({ artifactPath: broken })).toThrow(/gzip/);
  });

  it("validates a source without writing in dry-run mode and reports loader compatibility", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const dest = join(dir, "should-not-exist.gz");
    seed(source).close();
    const report = await packSnapshot({
      sourcePath: source,
      destPath: dest,
      dryRun: true,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(report.stage).toBe("source-checked");
    expect(report.sourcePackable).toBe(true);
    expect(report.loaderCompatible).toBe(true);
    expect(report.artifactValidated).toBe(false);
    expect(report.deployed).toBe(false);
    expect(report.effectiveWatchlistCount).toBe(2);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a read-only snapshot refresh before fetching", async () => {
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      {
        readPriceDate: () => "2026-09-18",
        importPrices: async () => {
          throw new Error("prices were fetched");
        },
      },
    );
    expect(report.overall).toBe("REFUSED");
    expect(report.persistence).toBe("refused-read-only-snapshot");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
