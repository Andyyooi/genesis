import { createHash } from "node:crypto";
import {
  copyFileSync,
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
import { migrateSqliteSchema } from "@/db/client";
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
  /** Watchlist size after the existing schema migration that read-only hosts apply on /tmp. */
  effectiveWatchlistCount: number | null;
  financialPeriodCount: number | null;
  priceBarCount: number | null;
  latestPriceDate: string | null;
  latestFinancialPeriod: string | null;
  scoreRunCount: number | null;
  fairValueRunCount: number | null;
  unsupportedFairValueCount: number | null;
  noValueFairValueCount: number | null;
  /** True when a disposable copy of the packaged image accepts migrateSqliteSchema. */
  loaderCompatible: boolean | null;
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
  effectiveWatchlistCount: number;
  instrumentSet: string;
  watchlistSet: string;
  effectiveWatchlistSet: string;
  financialPeriodCount: number;
  priceBarCount: number;
  latestPriceDate: string | null;
  latestFinancialPeriod: string | null;
  scoreRunCount: number;
  fairValueRunCount: number;
  unsupportedFairValueCount: number | null;
  noValueFairValueCount: number | null;
  financialFingerprint: string;
  priceFingerprint: string;
  scoreFingerprint: string;
  fairValueFingerprint: string;
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
  const line = (label: string, value: string | number | null | boolean) =>
    `${label}: ${value == null ? "unavailable" : String(value)}`;
  const lines = [
    "Snapshot report",
    line("Stage", report.stage),
    "Deployed to the website: no",
    "This command does not publish to Vercel. A local artifact stays on this computer until it is committed and deployed.",
    line("Source database", report.sourcePath),
    line("Candidate artifact", report.artifactPath),
    line("Source can be packaged", report.sourcePackable ? "yes" : "no"),
    line("Artifact passed validation", report.artifactValidated ? "yes" : "no"),
    line("Loader-compatible", report.loaderCompatible == null ? null : report.loaderCompatible ? "yes" : "no"),
    line("Integrity", report.integrity),
    line("Instruments", report.instrumentCount),
    line("Watchlist (stored)", report.watchlistCount),
    line("Watchlist (after schema open)", report.effectiveWatchlistCount),
    line("Financial periods", report.financialPeriodCount),
    line("Price bars", report.priceBarCount),
    line("Latest stored price date", report.latestPriceDate),
    line("Latest financial period", report.latestFinancialPeriod),
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
    "Fingerprints cover instrument tickers, watchlist tickers, financial-period keys, price bars (instrument, date, close, source), score runs, and Fair Value rows. They catch omissions and value changes in those fields. They do not prove every text column or related table is identical. Packaging does not run schema migration on the source; read-only hosts migrate a /tmp copy when the app opens the snapshot. A read-only open can refresh the source shared-memory file without writing the database or its WAL.",
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
  if (source.blockers.length) {
    throw new SnapshotRejected(
      reportFromCensus({
        stage: "source-checked",
        sourcePath,
        artifactPath: options.destPath ? resolve(options.destPath) : null,
        census: source,
        artifactValidated: false,
        artifactBytes: null,
        differsFromCurrent: null,
        currentSnapshotPath: currentPath,
        loaderCompatible: null,
      }),
    );
  }

  const work = mkdtempSync(join(tmpdir(), "genesis-snapshot-"));
  const partial = options.destPath ? `${resolve(options.destPath)}.partial` : null;
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
          artifactPath: options.destPath ? resolve(options.destPath) : null,
          census: image,
          artifactValidated: false,
          artifactBytes: null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: drift,
          loaderCompatible: false,
        }),
      );
    }

    const loader = verifyLoaderCompatibility(imagePath);
    const censusForReport = applyLoaderWatchlist(image, loader);
    if (!loader.ok) {
      throw new SnapshotRejected(
        reportFromCensus({
          stage: "source-checked",
          sourcePath,
          artifactPath: options.destPath ? resolve(options.destPath) : null,
          census: censusForReport,
          artifactValidated: false,
          artifactBytes: null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: [loader.error ?? "Application loader cannot open this snapshot"],
          loaderCompatible: false,
        }),
      );
    }

    if (options.dryRun || !options.destPath) {
      return reportFromCensus({
        stage: "source-checked",
        sourcePath,
        artifactPath: options.destPath ? resolve(options.destPath) : null,
        census: censusForReport,
        artifactValidated: false,
        artifactBytes: null,
        differsFromCurrent: null,
        currentSnapshotPath: currentPath,
        loaderCompatible: true,
      });
    }

    const destPath = resolve(options.destPath);
    mkdirSync(dirname(destPath), { recursive: true });
    await gzipFile(imagePath, partial!);
    const roundTripPath = join(work, "roundtrip.db");
    writeFileSync(roundTripPath, gunzipSync(readFileSync(partial!)));
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
          artifactBytes: existsSync(partial!) ? statSync(partial!).size : null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: roundTripDrift,
          loaderCompatible: true,
        }),
      );
    }
    const roundTripLoader = verifyLoaderCompatibility(roundTripPath);
    const roundTripReport = applyLoaderWatchlist(roundTrip, roundTripLoader);
    if (!roundTripLoader.ok) {
      throw new SnapshotRejected(
        reportFromCensus({
          stage: "source-checked",
          sourcePath,
          artifactPath: destPath,
          census: roundTripReport,
          artifactValidated: false,
          artifactBytes: existsSync(partial!) ? statSync(partial!).size : null,
          differsFromCurrent: null,
          currentSnapshotPath: currentPath,
          extraBlockers: [roundTripLoader.error ?? "Compressed artifact failed loader migration"],
          loaderCompatible: false,
        }),
      );
    }
    renameSync(partial!, destPath);
    return reportFromCensus({
      stage: "packaged",
      sourcePath,
      artifactPath: destPath,
      census: roundTripReport,
      artifactValidated: true,
      artifactBytes: statSync(destPath).size,
      differsFromCurrent: differsFromSnapshot(destPath, currentPath),
      currentSnapshotPath: currentPath,
      loaderCompatible: true,
    });
  } catch (error) {
    if (partial && existsSync(partial)) unlinkSync(partial);
    if (error instanceof SnapshotRejected) throw error;
    throw new SnapshotRejected(
      emptyReport({
        stage: "refused",
        sourcePath,
        artifactPath: options.destPath ? resolve(options.destPath) : null,
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
    const loader = verifyLoaderCompatibility(databasePath);
    const withLoader = applyLoaderWatchlist(census, loader);
    const blockers = [
      ...extra,
      ...(loader.ok ? [] : [loader.error ?? "Application loader cannot open this snapshot"]),
    ];
    const report = reportFromCensus({
      stage: "validated",
      sourcePath,
      artifactPath,
      census: withLoader,
      artifactValidated: census.blockers.length === 0 && blockers.length === 0,
      artifactBytes: statSync(artifactPath).size,
      differsFromCurrent: differsFromSnapshot(artifactPath, currentPath),
      currentSnapshotPath: currentPath,
      extraBlockers: blockers,
      loaderCompatible: loader.ok,
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

function verifyLoaderCompatibility(imagePath: string): {
  ok: boolean;
  error: string | null;
  effectiveWatchlistCount: number | null;
  effectiveWatchlistSet: string | null;
} {
  const migratePath = `${imagePath}.migrate-check`;
  try {
    copyFileSync(imagePath, migratePath);
    const migrator = new Database(migratePath);
    try {
      migrateSqliteSchema(migrator);
      const rows = migrator
        .prepare("SELECT ticker FROM instruments WHERE watchlist = 1 ORDER BY ticker")
        .all() as { ticker: string }[];
      return {
        ok: true,
        error: null,
        effectiveWatchlistCount: rows.length,
        effectiveWatchlistSet: digest(rows.map((row) => row.ticker)),
      };
    } finally {
      migrator.close();
    }
  } catch (error) {
    return {
      ok: false,
      error: `Application loader cannot migrate this snapshot${
        error instanceof Error ? `: ${error.message}` : ""
      }`,
      effectiveWatchlistCount: null,
      effectiveWatchlistSet: null,
    };
  } finally {
    if (existsSync(migratePath)) unlinkSync(migratePath);
  }
}

function applyLoaderWatchlist(census: Census, loader: ReturnType<typeof verifyLoaderCompatibility>): Census {
  if (!loader.ok || loader.effectiveWatchlistCount == null || !loader.effectiveWatchlistSet) return census;
  return {
    ...census,
    effectiveWatchlistCount: loader.effectiveWatchlistCount,
    effectiveWatchlistSet: loader.effectiveWatchlistSet,
    warnings: census.warnings,
  };
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
    const instrumentColumns = new Set(
      (sqlite.pragma("table_info(instruments)") as { name: string }[]).map((column) => column.name),
    );
    const effectiveWatchlistRows = predictedEffectiveWatchlist(sqlite, instrumentColumns.has("universe_source"));
    if (effectiveWatchlistRows.length !== watchlistRows.length) {
      warnings.push(
        `${effectiveWatchlistRows.length - watchlistRows.length} additional name(s) become watched when the application opens this snapshot. Stored watchlist ${watchlistRows.length}; after schema open ${effectiveWatchlistRows.length}.`,
      );
    }
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
    const financialRows = sqlite
      .prepare(
        "SELECT instrument_id AS instrumentId, period_end AS periodEnd, statement_type AS statementType FROM financial_periods ORDER BY instrument_id, period_end, statement_type",
      )
      .all() as { instrumentId: number; periodEnd: string; statementType: string }[];
    const priceRows = sqlite
      .prepare(
        "SELECT instrument_id AS instrumentId, bar_date AS barDate, close AS close, source AS source FROM price_bars ORDER BY instrument_id, bar_date, source",
      )
      .all() as { instrumentId: number; barDate: string; close: number | null; source: string }[];
    const scoreRows = sqlite
      .prepare("SELECT instrument_id AS instrumentId, research_score AS researchScore FROM score_runs ORDER BY instrument_id, research_score")
      .all() as { instrumentId: number; researchScore: number | null }[];
    const fairValueRows = sqlite
      .prepare(
        `SELECT instrument_id AS instrumentId, ticker AS ticker, model_version AS modelVersion,
                fair_value_base AS fairValueBase, ${
                  fairValueColumns.has("quality_status") ? "quality_status" : "NULL"
                } AS qualityStatus
         FROM fair_value_runs
         ORDER BY instrument_id, ticker, model_version, fair_value_base`,
      )
      .all() as {
      instrumentId: number;
      ticker: string;
      modelVersion: string;
      fairValueBase: number | null;
      qualityStatus: string | null;
    }[];
    return {
      integrity,
      integrityDetail,
      instrumentCount: instrumentRows.length,
      watchlistCount: watchlistRows.length,
      effectiveWatchlistCount: effectiveWatchlistRows.length,
      instrumentSet: digest(instrumentRows.map((row) => row.ticker)),
      watchlistSet: digest(watchlistRows.map((row) => row.ticker)),
      effectiveWatchlistSet: digest(effectiveWatchlistRows),
      financialPeriodCount: financialRows.length,
      priceBarCount: priceRows.length,
      latestPriceDate: latestUsablePriceDate(sqlite),
      latestFinancialPeriod: latestUsableFinancialPeriod(financialRows.map((row) => row.periodEnd)),
      scoreRunCount: scoreRows.length,
      fairValueRunCount: fairValueRows.length,
      unsupportedFairValueCount,
      noValueFairValueCount,
      financialFingerprint: digest(
        financialRows.map((row) => `${row.instrumentId}|${row.periodEnd}|${row.statementType}`),
      ),
      priceFingerprint: digest(
        priceRows.map(
          (row) => `${row.instrumentId}|${row.barDate}|${formatNumber(row.close)}|${row.source}`,
        ),
      ),
      scoreFingerprint: digest(
        scoreRows.map((row) => `${row.instrumentId}|${formatNumber(row.researchScore)}`),
      ),
      fairValueFingerprint: digest(
        fairValueRows.map(
          (row) =>
            `${row.instrumentId}|${row.ticker}|${row.modelVersion}|${formatNumber(row.fairValueBase)}|${row.qualityStatus ?? ""}`,
        ),
      ),
      warnings,
      blockers,
    };
  } finally {
    sqlite.close();
  }
}

function predictedEffectiveWatchlist(sqlite: Database.Database, hasUniverseSource: boolean) {
  if (!hasUniverseSource) {
    return (sqlite.prepare("SELECT ticker FROM instruments ORDER BY ticker").all() as { ticker: string }[]).map(
      (row) => row.ticker,
    );
  }
  return (
    sqlite
      .prepare(
        `SELECT ticker FROM instruments
         WHERE watchlist = 1 OR watchlist IS NULL OR (watchlist = 0 AND universe_source IS NULL)
         ORDER BY ticker`,
      )
      .all() as { ticker: string }[]
  ).map((row) => row.ticker);
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

function latestUsableFinancialPeriod(values: string[]) {
  return [...values].filter(isRealCalendarDate).sort().at(-1) ?? null;
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
  if (copy.financialPeriodCount !== source.financialPeriodCount || copy.financialFingerprint !== source.financialFingerprint) {
    problems.push(`${label} financial-period fingerprint differs from the source`);
  }
  if (copy.priceBarCount !== source.priceBarCount || copy.priceFingerprint !== source.priceFingerprint) {
    problems.push(`${label} price-bar fingerprint differs from the source`);
  }
  if (copy.latestPriceDate !== source.latestPriceDate) {
    problems.push(`${label} latest price date differs from the source`);
  }
  if (copy.latestFinancialPeriod !== source.latestFinancialPeriod) {
    problems.push(`${label} latest financial period differs from the source`);
  }
  if (copy.scoreRunCount !== source.scoreRunCount || copy.scoreFingerprint !== source.scoreFingerprint) {
    problems.push(`${label} score-run fingerprint differs from the source`);
  }
  if (copy.fairValueRunCount !== source.fairValueRunCount || copy.fairValueFingerprint !== source.fairValueFingerprint) {
    problems.push(`${label} Fair Value fingerprint differs from the source`);
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
  loaderCompatible: boolean | null;
}): SnapshotReport {
  const blockers = [...args.census.blockers, ...(args.extraBlockers ?? [])];
  return {
    stage: args.stage,
    deployed: false,
    sourcePath: args.sourcePath,
    artifactPath: args.artifactPath,
    sourcePackable: args.census.blockers.length === 0 && args.loaderCompatible !== false,
    artifactValidated: args.artifactValidated && blockers.length === 0,
    integrity: args.census.integrity,
    instrumentCount: args.census.instrumentCount,
    watchlistCount: args.census.watchlistCount,
    effectiveWatchlistCount: args.census.effectiveWatchlistCount,
    financialPeriodCount: args.census.financialPeriodCount,
    priceBarCount: args.census.priceBarCount,
    latestPriceDate: args.census.latestPriceDate,
    latestFinancialPeriod: args.census.latestFinancialPeriod,
    scoreRunCount: args.census.scoreRunCount,
    fairValueRunCount: args.census.fairValueRunCount,
    unsupportedFairValueCount: args.census.unsupportedFairValueCount,
    noValueFairValueCount: args.census.noValueFairValueCount,
    loaderCompatible: args.loaderCompatible,
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
    effectiveWatchlistCount: null,
    financialPeriodCount: null,
    priceBarCount: null,
    latestPriceDate: null,
    latestFinancialPeriod: null,
    scoreRunCount: null,
    fairValueRunCount: null,
    unsupportedFairValueCount: null,
    noValueFairValueCount: null,
    loaderCompatible: null,
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
    effectiveWatchlistCount: 0,
    instrumentSet: "",
    watchlistSet: "",
    effectiveWatchlistSet: "",
    financialPeriodCount: 0,
    priceBarCount: 0,
    latestPriceDate: null,
    latestFinancialPeriod: null,
    scoreRunCount: 0,
    fairValueRunCount: 0,
    unsupportedFairValueCount: null,
    noValueFairValueCount: null,
    financialFingerprint: "",
    priceFingerprint: "",
    scoreFingerprint: "",
    fairValueFingerprint: "",
    warnings: [],
    blockers,
  };
}

function numbered(row: { n: number } | undefined) {
  return row?.n ?? 0;
}

function formatNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "";
  return Number(value).toFixed(6);
}

function digest(values: string[]) {
  return createHash("sha256").update(values.join("\n")).digest("hex");
}

function digestBuffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
