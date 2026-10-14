import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { snapshotGzPath } from "@/db/snapshot-file";

const REQUIRED_TABLES = [
  "instruments",
  "price_bars",
  "financial_periods",
  "score_runs",
  "fair_value_runs",
] as const;

const REQUIRED_COLUMNS: Record<(typeof REQUIRED_TABLES)[number], string[]> = {
  instruments: ["id", "ticker", "name", "watchlist"],
  price_bars: ["instrument_id", "bar_date", "close", "source"],
  financial_periods: ["instrument_id", "period_end", "statement_type"],
  score_runs: ["instrument_id", "research_score"],
  fair_value_runs: ["instrument_id", "ticker", "model_version", "fair_value_base"],
};

export type SnapshotStage = "refused" | "source-checked" | "packaged" | "validated";

export type SnapshotReport = {
  stage: SnapshotStage;
  /** Packaging and validation never publish the website. */
  deployed: false;
  sourcePath: string | null;
  artifactPath: string | null;
  sourcePackable: boolean;
  artifactValidated: boolean;
  integrity: "ok" | "failed" | "not-read";
  instrumentCount: number | null;
  watchlistCount: number | null;
  priceBarCount: number | null;
  latestPriceDate: string | null;
  scoreRunCount: number | null;
  fairValueRunCount: number | null;
  unsupportedFairValueCount: number | null;
  noValueFairValueCount: number | null;
  artifactBytes: number | null;
  differsFromCurrent: boolean | null;
  currentSnapshotPath: string | null;
  warnings: string[];
  blockers: string[];
};

export class SnapshotRejected extends Error {
  readonly report: SnapshotReport;

  constructor(report: SnapshotReport) {
    super(report.blockers[0] ?? "Snapshot check failed");
    this.name = "SnapshotRejected";
    this.report = report;
  }
}

export type PackSnapshotOptions = {
  sourcePath: string;
  destPath?: string;
  dryRun?: boolean;
  writeProduction?: boolean;
  /** Defaults to data/snapshots/research.db.gz. Tests pass an isolated path. */
  productionPath?: string;
  currentSnapshotPath?: string;
};

type Census = {
  integrity: "ok" | "failed";
  integrityDetail: string;
  instrumentCount: number;
  watchlistCount: number;
  instrumentSet: string;
  watchlistSet: string;
  priceBarCount: number;
  latestPriceDate: string | null;
  scoreRunCount: number;
  fairValueRunCount: number;
  unsupportedFairValueCount: number | null;
  noValueFairValueCount: number | null;
  warnings: string[];
  blockers: string[];
};

export function productionSnapshotPath(configured?: string) {
  return resolve(configured ?? snapshotGzPath());
}

export function sameSnapshotPath(left: string, right: string) {
  const a = resolve(left);
  const b = resolve(right);
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

export function formatSnapshotReport(report: SnapshotReport) {
  const line = (label: string, value: string | number | null) => `${label}: ${value ?? "unavailable"}`;
  const lines = [
    "Snapshot report",
    line("Stage", report.stage),
    "Deployed to the website: no",
    "This command does not publish to Vercel. A local artifact stays on this computer until it is committed and deployed.",
    line("Source database", report.sourcePath),
    line("Candidate artifact", report.artifactPath),
    line("Source can be packaged", report.sourcePackable ? "yes" : "no"),
    line("Artifact passed validation", report.artifactValidated ? "yes" : "no"),
    line("Integrity", report.integrity),
    line("Instruments", report.instrumentCount),
    line("Watchlist", report.watchlistCount),
    line("Price bars", report.priceBarCount),
    line("Latest stored price date", report.latestPriceDate),
    line("Score runs", report.scoreRunCount),
    line("Fair Value runs", report.fairValueRunCount),
    line("Unsupported Fair Value rows", report.unsupportedFairValueCount),
    line("No-value Fair Value rows", report.noValueFairValueCount),
    line("Artifact bytes", report.artifactBytes),
    line(
      "Differs from current snapshot",
      report.differsFromCurrent == null ? null : report.differsFromCurrent ? "yes" : "no",
    ),
    line("Current snapshot", report.currentSnapshotPath),
  ];
  lines.push(report.warnings.length ? `Warnings: ${report.warnings.join(" ")}` : "Warnings: none");
  lines.push(report.blockers.length ? `Blockers: ${report.blockers.join(" ")}` : "Blockers: none");
  lines.push(
    "Counts, ticker sets, and the latest price date do not prove every row is identical. A read-only open can refresh the source shared-memory file without writing the database or its WAL.",
  );
  return lines.join("\n");
}

export async function packSnapshot(options: PackSnapshotOptions): Promise<SnapshotReport> {
  const sourcePath = resolve(options.sourcePath);
  const productionPath = productionSnapshotPath(options.productionPath);
  const currentPath = options.currentSnapshotPath ? resolve(options.currentSnapshotPath) : null;
  if (
    !options.dryRun &&
    options.destPath &&
    sameSnapshotPath(options.destPath, productionPath) &&
    !options.writeProduction
  ) {
    throw new SnapshotRejected(
      emptyReport({
        stage: "refused",
        sourcePath,
        artifactPath: resolve(options.destPath),
        currentSnapshotPath: currentPath,
        blockers: [
          `Refusing to overwrite the production snapshot at ${productionPath}. Pass --write-production to opt in. Nothing was written.`,
        ],
      }),
    );
  }
  if (!options.dryRun && !options.destPath) {
    throw new SnapshotRejected(
      emptyReport({
        stage: "refused",
        sourcePath,
        currentSnapshotPath: currentPath,
        blockers: [
          "A destination artifact is required. Pass --dest, or pass --dry-run to validate the source without writing. The production snapshot is not the default destination.",
        ],
      }),
    );
  }

  const source = readCensus(sourcePath);
  const sourceReport = reportFromCensus({
    stage: "source-checked",
    sourcePath,
    artifactPath: options.destPath ? resolve(options.destPath) : null,
    census: source,
    artifactValidated: false,
    artifactBytes: null,
    differsFromCurrent: null,
    currentSnapshotPath: currentPath,
  });
  if (!sourceReport.sourcePackable) throw new SnapshotRejected(sourceReport);
  if (options.dryRun || !options.destPath) return sourceReport;

  const destPath = resolve(options.destPath);
  const work = mkdtempSync(join(tmpdir(), "genesis-snapshot-"));
  const partial = `${destPath}.partial`;
  try {
    const imagePath = join(work, "image.db");
    await backupReadOnly(sourcePath, imagePath);
    const image = readCensus(imagePath);
    const drift = censusDrift("packaged image", source, image);
    if (image.blockers.length || drift.length) {
      throw new SnapshotRejected(
        reportFromCensus({
          stage: "source-checked",
          sourcePath,
          artifactPath: destPath,
          census: image,
          artifactValidated: false,
          artifactBytes: null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: drift,
        }),
      );
    }
    mkdirSync(dirname(destPath), { recursive: true });
    await gzipFile(imagePath, partial);
    const roundTripPath = join(work, "roundtrip.db");
    writeFileSync(roundTripPath, gunzipSync(readFileSync(partial)));
    const roundTrip = readCensus(roundTripPath);
    const roundTripDrift = censusDrift("compressed artifact", source, roundTrip);
    if (roundTrip.blockers.length || roundTripDrift.length) {
      throw new SnapshotRejected(
        reportFromCensus({
          stage: "source-checked",
          sourcePath,
          artifactPath: destPath,
          census: roundTrip,
          artifactValidated: false,
          artifactBytes: existsSync(partial) ? statSync(partial).size : null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: roundTripDrift,
        }),
      );
    }
    renameSync(partial, destPath);
    const artifactBytes = statSync(destPath).size;
    return reportFromCensus({
      stage: "packaged",
      sourcePath,
      artifactPath: destPath,
      census: roundTrip,
      artifactValidated: true,
      artifactBytes,
      differsFromCurrent: differsFromSnapshot(destPath, currentPath),
      currentSnapshotPath: currentPath,
    });
  } catch (error) {
    if (existsSync(partial)) unlinkSync(partial);
    if (error instanceof SnapshotRejected) throw error;
    throw new SnapshotRejected(
      emptyReport({
        stage: "refused",
        sourcePath,
        artifactPath: destPath,
        currentSnapshotPath: currentPath,
        blockers: [error instanceof Error ? error.message : "Snapshot packaging failed"],
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function validateSnapshotArtifact(options: {
  artifactPath: string;
  sourcePath?: string;
  currentSnapshotPath?: string;
}): SnapshotReport {
  const artifactPath = resolve(options.artifactPath);
  const sourcePath = options.sourcePath ? resolve(options.sourcePath) : null;
  const currentPath = options.currentSnapshotPath ? resolve(options.currentSnapshotPath) : null;
  const work = mkdtempSync(join(tmpdir(), "genesis-snapshot-validate-"));
  try {
    const databasePath = join(work, "candidate.db");
    try {
      writeFileSync(databasePath, gunzipSync(readFileSync(artifactPath)));
    } catch (error) {
      throw new SnapshotRejected(
        emptyReport({
          stage: "validated",
          sourcePath,
          artifactPath,
          currentSnapshotPath: currentPath,
          blockers: [
            `Candidate artifact could not be read as a gzip SQLite snapshot${
              error instanceof Error ? `: ${error.message}` : ""
            }`,
          ],
        }),
      );
    }
    const census = readCensus(databasePath);
    const extra = sourcePath ? censusDrift("candidate artifact", readCensus(sourcePath), census) : [];
    const report = reportFromCensus({
      stage: "validated",
      sourcePath,
      artifactPath,
      census,
      artifactValidated: census.blockers.length === 0 && extra.length === 0,
      artifactBytes: statSync(artifactPath).size,
      differsFromCurrent: differsFromSnapshot(artifactPath, currentPath),
      currentSnapshotPath: currentPath,
      extraBlockers: extra,
    });
    if (!report.artifactValidated) throw new SnapshotRejected(report);
    return report;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function backupReadOnly(sourcePath: string, imagePath: string) {
  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(imagePath);
  } finally {
    sqlite.close();
  }
}

async function gzipFile(sourcePath: string, destPath: string) {
  await pipeline(createReadStream(sourcePath), createGzip({ level: 9 }), createWriteStream(destPath));
}

function readCensus(filePath: string): Census {
  let sqlite: Database.Database;
  try {
    sqlite = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "database could not be opened";
    return failedCensus([`Database is inaccessible or not SQLite (${filePath}): ${reason}`]);
  }
  try {
    let integrityRows: { integrity_check: string }[];
    try {
      integrityRows = sqlite.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "integrity check failed";
      return failedCensus([`Database is corrupt or incomplete (${filePath}): ${reason}`]);
    }
    const integrityDetail = integrityRows.map((row) => row.integrity_check).join("; ") || "no integrity result";
    const integrity = integrityRows.length === 1 && integrityRows[0]?.integrity_check === "ok" ? "ok" : "failed";
    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (integrity !== "ok") blockers.push(`SQLite integrity check failed: ${integrityDetail}`);
    for (const table of REQUIRED_TABLES) {
      if (!tables.has(table)) blockers.push(`Missing required table ${table}`);
    }
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS) as Array<[keyof typeof REQUIRED_COLUMNS, string[]]>) {
      if (!tables.has(table)) continue;
      const present = new Set(
        (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name),
      );
      for (const column of columns) {
        if (!present.has(column)) blockers.push(`Table ${table} is missing required column ${column}`);
      }
    }
    if (blockers.length) {
      return {
        ...failedCensus(blockers),
        integrity,
        integrityDetail,
        warnings,
      };
    }
    const instrumentRows = sqlite.prepare("SELECT ticker FROM instruments ORDER BY ticker").all() as { ticker: string }[];
    const watchlistRows = sqlite
      .prepare("SELECT ticker FROM instruments WHERE watchlist = 1 ORDER BY ticker")
      .all() as { ticker: string }[];
    const priceBarCount = count(sqlite, "price_bars");
    const latestPriceDate = latestUsablePriceDate(sqlite);
    const fairValueColumns = new Set(
      (sqlite.pragma("table_info(fair_value_runs)") as { name: string }[]).map((column) => column.name),
    );
    let unsupportedFairValueCount: number | null = null;
    let noValueFairValueCount: number | null = null;
    if (fairValueColumns.has("model_version")) {
      unsupportedFairValueCount = numbered(
        sqlite.prepare("SELECT COUNT(*) AS n FROM fair_value_runs WHERE model_version = 'unsupported'").get() as {
          n: number;
        },
      );
    } else {
      warnings.push("Fair Value model_version is unavailable, so unsupported rows were not counted.");
    }
    if (fairValueColumns.has("quality_status")) {
      noValueFairValueCount = numbered(
        sqlite.prepare("SELECT COUNT(*) AS n FROM fair_value_runs WHERE quality_status = 'NO_VALUE'").get() as {
          n: number;
        },
      );
    } else {
      warnings.push("Fair Value quality_status is unavailable, so no-value rows were not counted.");
    }
    const instrumentColumns = new Set(
      (sqlite.pragma("table_info(instruments)") as { name: string }[]).map((column) => column.name),
    );
    if (instrumentColumns.has("universe_source")) {
      const unmarked = numbered(
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM instruments WHERE watchlist = 0 AND universe_source IS NULL")
          .get() as { n: number },
      );
      if (unmarked > 0) {
        warnings.push(
          `${unmarked} instruments are unwatched and have no universe source. Opening the snapshot applies the existing schema migration, which marks those rows watched. The watchlist count above is the stored value before that migration.`,
        );
      }
    } else if (watchlistRows.length < instrumentRows.length) {
      warnings.push(
        "instruments.universe_source is missing. Opening the snapshot adds it as null, and the existing schema migration then marks unwatched rows as watched. The watchlist count above is the stored value before that migration.",
      );
    }
    return {
      integrity,
      integrityDetail,
      instrumentCount: instrumentRows.length,
      watchlistCount: watchlistRows.length,
      instrumentSet: digest(instrumentRows.map((row) => row.ticker)),
      watchlistSet: digest(watchlistRows.map((row) => row.ticker)),
      priceBarCount,
      latestPriceDate,
      scoreRunCount: count(sqlite, "score_runs"),
      fairValueRunCount: count(sqlite, "fair_value_runs"),
      unsupportedFairValueCount,
      noValueFairValueCount,
      warnings,
      blockers,
    };
  } finally {
    sqlite.close();
  }
}

function latestUsablePriceDate(sqlite: Database.Database) {
  const rows = sqlite
    .prepare(
      `SELECT bar_date AS barDate FROM price_bars
       WHERE bar_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
       GROUP BY bar_date
       ORDER BY bar_date DESC
       LIMIT 30`,
    )
    .all() as { barDate: string }[];
  return rows.map((row) => row.barDate).find(isRealCalendarDate) ?? null;
}

function isRealCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day && year >= 1990;
}

function censusDrift(label: string, source: Census, copy: Census) {
  const problems: string[] = [];
  if (copy.integrity !== "ok") problems.push(`${label} failed the SQLite integrity check`);
  if (copy.instrumentCount !== source.instrumentCount || copy.instrumentSet !== source.instrumentSet) {
    problems.push(`${label} does not contain the same instruments as the source`);
  }
  if (copy.watchlistCount !== source.watchlistCount || copy.watchlistSet !== source.watchlistSet) {
    problems.push(`${label} does not contain the same watchlist as the source`);
  }
  if (copy.priceBarCount !== source.priceBarCount) problems.push(`${label} price-bar count differs from the source`);
  if (copy.latestPriceDate !== source.latestPriceDate) {
    problems.push(`${label} latest price date differs from the source`);
  }
  if (copy.scoreRunCount !== source.scoreRunCount) problems.push(`${label} score-run count differs from the source`);
  if (copy.fairValueRunCount !== source.fairValueRunCount) {
    problems.push(`${label} Fair Value row count differs from the source`);
  }
  return problems;
}

function differsFromSnapshot(artifactPath: string, currentPath: string | null) {
  if (!currentPath || !existsSync(currentPath)) return null;
  if (sameSnapshotPath(artifactPath, currentPath)) return false;
  return digestBuffer(readFileSync(artifactPath)) !== digestBuffer(readFileSync(currentPath));
}

function reportFromCensus(args: {
  stage: SnapshotStage;
  sourcePath: string | null;
  artifactPath: string | null;
  census: Census;
  artifactValidated: boolean;
  artifactBytes: number | null;
  differsFromCurrent: boolean | null;
  currentSnapshotPath: string | null;
  extraBlockers?: string[];
}): SnapshotReport {
  const blockers = [...args.census.blockers, ...(args.extraBlockers ?? [])];
  return {
    stage: args.stage,
    deployed: false,
    sourcePath: args.sourcePath,
    artifactPath: args.artifactPath,
    sourcePackable: args.census.blockers.length === 0,
    artifactValidated: args.artifactValidated && blockers.length === 0,
    integrity: args.census.integrity,
    instrumentCount: args.census.instrumentCount,
    watchlistCount: args.census.watchlistCount,
    priceBarCount: args.census.priceBarCount,
    latestPriceDate: args.census.latestPriceDate,
    scoreRunCount: args.census.scoreRunCount,
    fairValueRunCount: args.census.fairValueRunCount,
    unsupportedFairValueCount: args.census.unsupportedFairValueCount,
    noValueFairValueCount: args.census.noValueFairValueCount,
    artifactBytes: args.artifactBytes,
    differsFromCurrent: args.differsFromCurrent,
    currentSnapshotPath: args.currentSnapshotPath,
    warnings: args.census.warnings,
    blockers,
  };
}

function emptyReport(args: {
  stage: SnapshotStage;
  sourcePath?: string | null;
  artifactPath?: string | null;
  currentSnapshotPath?: string | null;
  blockers: string[];
}): SnapshotReport {
  return {
    stage: args.stage,
    deployed: false,
    sourcePath: args.sourcePath ?? null,
    artifactPath: args.artifactPath ?? null,
    sourcePackable: false,
    artifactValidated: false,
    integrity: "not-read",
    instrumentCount: null,
    watchlistCount: null,
    priceBarCount: null,
    latestPriceDate: null,
    scoreRunCount: null,
    fairValueRunCount: null,
    unsupportedFairValueCount: null,
    noValueFairValueCount: null,
    artifactBytes: null,
    differsFromCurrent: null,
    currentSnapshotPath: args.currentSnapshotPath ?? null,
    warnings: [],
    blockers: args.blockers,
  };
}

function failedCensus(blockers: string[]): Census {
  return {
    integrity: "failed",
    integrityDetail: blockers[0] ?? "failed",
    instrumentCount: 0,
    watchlistCount: 0,
    instrumentSet: "",
    watchlistSet: "",
    priceBarCount: 0,
    latestPriceDate: null,
    scoreRunCount: 0,
    fairValueRunCount: 0,
    unsupportedFairValueCount: null,
    noValueFairValueCount: null,
    warnings: [],
    blockers,
  };
}

function count(sqlite: Database.Database, table: string) {
  return numbered(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number });
}

function numbered(row: { n: number } | undefined) {
  return row?.n ?? 0;
}

function digest(values: string[]) {
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

function digestBuffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
