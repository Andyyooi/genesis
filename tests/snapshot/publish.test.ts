import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { snapshotGzPath } from "@/db/snapshot-file";
import { runRefreshAndResearch } from "@/refresh/on-demand";
import {
  formatSnapshotReport,
  packSnapshot,
  SnapshotRejected,
  validateSnapshotArtifact,
} from "@/snapshot/publish";

const SCHEMA = `
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
    fair_value_base REAL,
    quality_status TEXT
  );
`;

function seed(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(SCHEMA);
  sqlite
    .prepare("INSERT INTO instruments (ticker, name, watchlist) VALUES (?, ?, ?)")
    .run("MAYBANK", "Malayan Banking", 1);
  sqlite.prepare("INSERT INTO instruments (ticker, name, watchlist) VALUES (?, ?, ?)").run("CIMB", "CIMB Group", 0);
  sqlite
    .prepare("INSERT INTO price_bars (instrument_id, bar_date, close, source) VALUES (1, '2026-09-18', 10, 'yahoo')")
    .run();
  sqlite
    .prepare("INSERT INTO price_bars (instrument_id, bar_date, close, source) VALUES (1, '9999-99-99', 1, 'yahoo')")
    .run();
  sqlite.prepare("INSERT INTO price_bars (instrument_id, bar_date, close, source) VALUES (1, '2026-10-12', 11, 'yahoo')").run();
  sqlite.prepare("INSERT INTO score_runs (instrument_id, research_score) VALUES (1, NULL)").run();
  sqlite
    .prepare(
      "INSERT INTO fair_value_runs (instrument_id, ticker, model_version, fair_value_base, quality_status) VALUES (1, 'MAYBANK', 'unsupported', NULL, 'NO_VALUE')",
    )
    .run();
  sqlite
    .prepare(
      "INSERT INTO fair_value_runs (instrument_id, ticker, model_version, fair_value_base, quality_status) VALUES (2, 'CIMB', 'general-relative-v1', 4.5, 'CLEAR')",
    )
    .run();
  return sqlite;
}

function fileMark(file: string) {
  const stat = statSync(file);
  return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
}

describe("snapshot packaging", () => {
  const dirs: string[] = [];
  const previousReadonly = process.env.BURSA_SNAPSHOT_READONLY;

  afterEach(() => {
    if (previousReadonly === undefined) delete process.env.BURSA_SNAPSHOT_READONLY;
    else process.env.BURSA_SNAPSHOT_READONLY = previousReadonly;
    vi.unstubAllGlobals();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
    const beforeWal = fileMark(`${source}-wal`);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const report = await packSnapshot({
      sourcePath: source,
      destPath: dest,
      currentSnapshotPath: current,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(fileMark(source)).toEqual(before);
    expect(fileMark(`${source}-wal`)).toEqual(beforeWal);
    sqlite.close();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(report.deployed).toBe(false);
    expect(report.stage).toBe("packaged");
    expect(report.artifactValidated).toBe(true);
    expect(report.instrumentCount).toBe(2);
    expect(report.watchlistCount).toBe(1);
    expect(report.priceBarCount).toBe(3);
    expect(report.latestPriceDate).toBe("2026-10-12");
    expect(report.scoreRunCount).toBe(1);
    expect(report.fairValueRunCount).toBe(2);
    expect(report.unsupportedFairValueCount).toBe(1);
    expect(report.noValueFairValueCount).toBe(1);
    expect(report.artifactBytes).toBeGreaterThan(0);
    expect(report.differsFromCurrent).toBe(true);
    expect(report.warnings.join(" ")).toContain("universe_source");
    expect(formatSnapshotReport(report)).toContain("Deployed to the website: no");

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
    expect(checked.differsFromCurrent).toBe(false);
    expect(checked.deployed).toBe(false);
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
    sqlite.exec(SCHEMA.replace("watchlist INTEGER NOT NULL DEFAULT 0", "notes TEXT"));
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
    const sqlite = seed(source);
    sqlite.close();
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
    const sqlite = seed(source);
    sqlite.close();
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
    const sqlite = seed(source);
    sqlite.close();
    await expect(packSnapshot({ sourcePath: source, destPath: committed })).rejects.toThrow(
      /Refusing to overwrite the production snapshot/,
    );
    expect(existsSync(committed) ? fileMark(committed) : null).toEqual(before);
  });

  it("rejects a candidate that does not match its source and a candidate that is not gzip", () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const other = join(dir, "other.db");
    const dest = join(dir, "candidate.db.gz");
    const sqlite = seed(source);
    sqlite.close();
    const extra = new Database(other);
    extra.exec(SCHEMA);
    extra.prepare("INSERT INTO instruments (ticker, name, watchlist) VALUES ('ONLY', 'Only', 1)").run();
    extra.close();
    return packSnapshot({
      sourcePath: source,
      destPath: dest,
      productionPath: join(dir, "production.db.gz"),
    }).then((report) => {
      expect(
        () => validateSnapshotArtifact({ artifactPath: dest, sourcePath: other }),
      ).toThrow(/same instruments/);
      expect(report.artifactValidated).toBe(true);
      const broken = join(dir, "broken.gz");
      writeFileSync(broken, Buffer.from("not gzip"));
      expect(() => validateSnapshotArtifact({ artifactPath: broken })).toThrow(/gzip/);
    });
  });

  it("validates a source without writing in dry-run mode", async () => {
    const dir = tempDir();
    const source = join(dir, "source.db");
    const dest = join(dir, "should-not-exist.gz");
    const sqlite = seed(source);
    sqlite.close();
    const report = await packSnapshot({
      sourcePath: source,
      destPath: dest,
      dryRun: true,
      productionPath: join(dir, "production.db.gz"),
    });
    expect(report.stage).toBe("source-checked");
    expect(report.sourcePackable).toBe(true);
    expect(report.artifactValidated).toBe(false);
    expect(report.deployed).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a read-only snapshot refresh before fetching", async () => {
    process.env.BURSA_SNAPSHOT_READONLY = "1";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const report = await runRefreshAndResearch(
      { ticker: "MAYBANK" },
      { readPriceDate: () => "2026-09-18", importPrices: async () => { throw new Error("prices were fetched"); } },
    );
    expect(report.overall).toBe("REFUSED");
    expect(report.persistence).toBe("refused-read-only-snapshot");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
