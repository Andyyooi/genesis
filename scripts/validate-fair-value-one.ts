/**
 * Validate one ticker's Fair Value persistence on a disposable SQLite copy.
 *
 * Reads the live database read-only, backups it with SQLite's backup API, and
 * inserts only through insertFairValueRun on that copy. Does not call getDb,
 * ensureSchema, persistFairValueRun, refreshFairValueUniverse, or runDailyRefresh.
 *
 * Usage: npx tsx scripts/validate-fair-value-one.ts --ticker TICKER
 */
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { isCliEntrypoint } from "@/cli/entrypoint";
import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { liveSqlitePath } from "@/db/snapshot-file";
import { calculateFairValue } from "@/fair-value/orchestrate";
import { FAIR_VALUE_QUALITY_VERSION, insertFairValueRun } from "@/fair-value/persist";
import { assessFairValueQuality, type FairValueQualityAnnual } from "@/fair-value/quality";
import type { FairValueResult } from "@/fair-value/types";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import { RESEARCH_PROFILES, type ResearchProfile } from "@/research/profiles";
import type { PeerUniverseRow } from "@/scoring/peer-group";
import { periodsToSnapshots } from "@/scoring/valuation-context";

const LIMITATION =
  "Unchanged file metadata, data_version, and fair_value_runs count show that this process did not observe a committed change to the live database. A writer that changed the live database and restored those values between checks would not be detected. This script does not hold a lock that excludes other processes for the whole run. The shared-memory file timestamp can change when a read-only connection coordinates with WAL, so that timestamp is not treated as a write.";

const REQUIRED_TABLES = ["instruments", "financial_periods", "price_bars", "fair_value_runs"] as const;

const REQUIRED_FAIR_VALUE_COLUMNS = [
  "id",
  "instrument_id",
  "ticker",
  "research_profile",
  "model_version",
  "valuation_date",
  "fundamentals_period_end",
  "current_price",
  "fair_value_low",
  "fair_value_base",
  "fair_value_high",
  "difference_vs_price",
  "confidence",
  "methods_json",
  "assumptions_json",
  "unavailable_reason",
  "calculated_at",
  "quality_status",
  "base_use",
  "quality_version",
  "quality_json",
  "observation_key",
] as const;

const OBSERVATION_INDEX_COLUMNS = [
  "instrument_id",
  "model_version",
  "quality_version",
  "observation_key",
] as const;

type FileStamp = {
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
  ino: number | null;
};

type LiveStamp = {
  db: FileStamp;
  wal: FileStamp;
  dataVersion: number;
  fairValueRuns: number;
  listedCount: number;
  instrumentCount: number;
};

type InstrumentRow = {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  instrumentType: string;
  researchProfile: string | null;
  listingStatus: string;
};

type PeriodRow = {
  instrumentId: number;
  periodEnd: string;
  availableAt: string | null;
  statementType: string;
  source: string;
  fiscalQuarter: number | null;
  lineItemsJson: string | null;
};

type BarRow = PriceBarSnapshot & { instrumentId: number };

type StoredUniverse = {
  listed: InstrumentRow[];
  snapshots: Map<number, StatementSnapshot[]>;
  bars: Map<number, PriceBarSnapshot[]>;
  peers: PeerUniverseRow[];
};

type PreparedRun = {
  instrumentId: number;
  result: FairValueResult;
  quality: ReturnType<typeof assessFairValueQuality>;
};

function refuse(message: string): never {
  throw new Error(message);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function stampFile(path: string): FileStamp {
  if (!existsSync(path)) return { exists: false, size: null, mtimeMs: null, ino: null };
  const stat = statSync(path);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino };
}

function sameStamp(left: FileStamp, right: FileStamp): boolean {
  return (
    left.exists === right.exists &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ino === right.ino
  );
}

function refuseEnvironment() {
  if (process.env.BURSA_SQLITE_PATH !== undefined) {
    refuse("Refusing validation: BURSA_SQLITE_PATH is set. Unset it so the live path cannot be redirected.");
  }
  if (process.env.VERCEL !== undefined) {
    refuse("Refusing validation: VERCEL is set.");
  }
  if (process.env.BURSA_SNAPSHOT_READONLY !== undefined) {
    refuse("Refusing validation: BURSA_SNAPSHOT_READONLY is set.");
  }
}

function readTicker(argv: string[]): string {
  const index = argv.indexOf("--ticker");
  const raw =
    index >= 0
      ? argv[index + 1]
      : argv.find((arg) => arg.startsWith("--ticker="))?.slice("--ticker=".length);
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9][A-Z0-9.-]*$/.test(ticker)) {
    refuse("Usage: npx tsx scripts/validate-fair-value-one.ts --ticker TICKER");
  }
  return ticker;
}

function resolveLiveDatabase(): string {
  const configured = resolve(liveSqlitePath());
  const expected = realpathSync(resolve(process.cwd(), "data", "sqlite", "research.db"));
  if (!existsSync(configured)) refuse(`Live database does not exist at ${configured}.`);
  const canonical = realpathSync(configured);
  if (canonical !== expected) {
    refuse(`Live database path ${canonical} is not the repository database ${expected}.`);
  }
  return canonical;
}

function readLiveFacts(sqlite: Database.Database, livePath: string): LiveStamp {
  if (!sqlite.readonly) refuse("Live database connection is not read-only.");
  const listed = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM instruments WHERE listing_status IS NULL OR listing_status != 'inactive'`,
    )
    .get() as { n: number };
  const instruments = sqlite.prepare(`SELECT COUNT(*) AS n FROM instruments`).get() as { n: number };
  const fairValue = sqlite.prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number };
  const version = sqlite.prepare(`PRAGMA data_version`).get() as { data_version: number };
  return {
    db: stampFile(livePath),
    wal: stampFile(`${livePath}-wal`),
    dataVersion: version.data_version,
    fairValueRuns: fairValue.n,
    listedCount: listed.n,
    instrumentCount: instruments.n,
  };
}

function assertLiveUnchanged(sqlite: Database.Database, livePath: string, baseline: LiveStamp) {
  const current = readLiveFacts(sqlite, livePath);
  const changed: string[] = [];
  if (!sameStamp(baseline.db, current.db)) changed.push("live database file metadata");
  if (!sameStamp(baseline.wal, current.wal)) changed.push("live WAL file metadata");
  if (baseline.dataVersion !== current.dataVersion) changed.push("data_version");
  if (baseline.fairValueRuns !== current.fairValueRuns) changed.push("fair_value_runs count");
  if (baseline.listedCount !== current.listedCount) changed.push("listed instrument count");
  if (baseline.instrumentCount !== current.instrumentCount) changed.push("instrument count");
  if (changed.length > 0) {
    refuse(`Aborting before any further write: live database changed (${changed.join(", ")}).`);
  }
}

function createDisposableDirectory(livePath: string): string {
  const tempRoot = realpathSync(tmpdir());
  const repoRoot = realpathSync(process.cwd());
  if (isInside(repoRoot, tempRoot) || tempRoot === repoRoot) {
    refuse(`OS temporary directory ${tempRoot} is inside the repository.`);
  }
  const dir = mkdtempSync(join(tempRoot, "genesis-fv-one-"));
  const canonical = realpathSync(dir);
  assertDisposablePath(canonical, livePath);
  return canonical;
}

function assertDisposablePath(path: string, livePath: string) {
  const tempRoot = realpathSync(tmpdir());
  const repoRoot = realpathSync(process.cwd());
  const canonical = realpathSync(path);
  const live = realpathSync(livePath);
  if (canonical === live || canonical === repoRoot || isInside(repoRoot, canonical) || isInside(canonical, live)) {
    refuse(`Disposable path ${canonical} is not outside the live database and repository.`);
  }
  if (!isInside(tempRoot, canonical)) {
    refuse(`Disposable path ${canonical} is not under the OS temporary directory.`);
  }
}

function removeDisposableDir(dir: string, livePath: string) {
  assertDisposablePath(dir, livePath);
  const live = realpathSync(livePath);
  if (dir === live || isInside(dir, live)) {
    refuse(`Refusing to delete ${dir} because it contains the live database.`);
  }
  rmSync(dir, { recursive: true, force: true });
}

function databaseFile(sqlite: Database.Database): string {
  const row = sqlite.prepare(`PRAGMA database_list`).all() as { name: string; file: string }[];
  const main = row.find((entry) => entry.name === "main");
  if (!main?.file) refuse("Database connection has no main file path.");
  return realpathSync(main.file);
}

function assertCopyReady(
  sqlite: Database.Database,
  destPath: string,
  livePath: string,
  source: LiveStamp,
  writable: boolean,
) {
  if (writable && sqlite.readonly) refuse("Insert connection to the disposable database is read-only.");
  if (!writable && !sqlite.readonly) refuse("Pre-insert inspection opened the disposable database writable.");
  const opened = databaseFile(sqlite);
  const dest = realpathSync(destPath);
  const live = realpathSync(livePath);
  if (opened !== dest) refuse(`Disposable connection opened ${opened}, not ${dest}.`);
  if (opened === live) refuse("Disposable connection resolved to the live database.");
  assertDisposablePath(opened, livePath);

  const tables = new Set(
    (
      sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  const missingTables = REQUIRED_TABLES.filter((name) => !tables.has(name));
  if (missingTables.length > 0) {
    refuse(`Disposable database is missing tables: ${missingTables.join(", ")}.`);
  }

  const columns = sqlite.prepare(`PRAGMA table_info(fair_value_runs)`).all() as { name: string }[];
  const columnNames = new Set(columns.map((column) => column.name));
  const missingColumns = REQUIRED_FAIR_VALUE_COLUMNS.filter((name) => !columnNames.has(name));
  if (missingColumns.length > 0) {
    refuse(`fair_value_runs is missing columns: ${missingColumns.join(", ")}.`);
  }

  const indexes = sqlite.prepare(`PRAGMA index_list(fair_value_runs)`).all() as {
    name: string;
    unique: number;
  }[];
  const observation = indexes.find((index) => index.name === "fair_value_runs_observation");
  if (!observation || observation.unique !== 1) {
    refuse("Disposable database is missing unique index fair_value_runs_observation.");
  }
  const indexColumns = (
    sqlite.prepare(`PRAGMA index_info(fair_value_runs_observation)`).all() as { name: string; seqno: number }[]
  )
    .sort((a, b) => a.seqno - b.seqno)
    .map((column) => column.name);
  if (indexColumns.join(",") !== OBSERVATION_INDEX_COLUMNS.join(",")) {
    refuse(
      `fair_value_runs_observation columns are ${indexColumns.join(", ")}, expected ${OBSERVATION_INDEX_COLUMNS.join(", ")}.`,
    );
  }

  const fairValue = sqlite.prepare(`SELECT COUNT(*) AS n FROM fair_value_runs`).get() as { n: number };
  const listed = sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM instruments WHERE listing_status IS NULL OR listing_status != 'inactive'`,
    )
    .get() as { n: number };
  const instruments = sqlite.prepare(`SELECT COUNT(*) AS n FROM instruments`).get() as { n: number };
  if (fairValue.n !== 0 || source.fairValueRuns !== 0) {
    refuse(
      `Expected fair_value_runs to start at 0 on the live database and the copy (live ${source.fairValueRuns}, copy ${fairValue.n}).`,
    );
  }
  if (listed.n !== source.listedCount || instruments.n !== source.instrumentCount || listed.n < 1) {
    refuse(
      `Disposable instrument counts do not match the live database (listed ${listed.n} vs ${source.listedCount}, instruments ${instruments.n} vs ${source.instrumentCount}).`,
    );
  }
}

function storedProfile(value: string | null): ResearchProfile {
  if (value && (RESEARCH_PROFILES as readonly string[]).includes(value)) return value as ResearchProfile;
  return "GENERAL";
}

function annualsFrom(periods: StatementSnapshot[]): FairValueQualityAnnual[] {
  return periods
    .filter((row) => row.statementType === "annual")
    .map((row) => ({
      periodEnd: row.periodEnd,
      eps: row.eps,
      pat: row.pat,
      shares: row.shares,
      dividendPerShare: row.dividendPerShare,
    }));
}

/** Same stored-data assembly as refresh loadStoredUniverse, against an explicit connection. */
function loadStoredUniverse(sqlite: Database.Database): StoredUniverse {
  const instruments = sqlite
    .prepare(
      `SELECT id, ticker, name, sector, industry,
              instrument_type AS instrumentType,
              research_profile AS researchProfile,
              listing_status AS listingStatus
       FROM instruments
       ORDER BY ticker ASC`,
    )
    .all() as InstrumentRow[];
  const periods = sqlite
    .prepare(
      `SELECT instrument_id AS instrumentId, period_end AS periodEnd,
              available_at AS availableAt, statement_type AS statementType,
              source, fiscal_quarter AS fiscalQuarter, line_items_json AS lineItemsJson
       FROM financial_periods`,
    )
    .all() as PeriodRow[];
  const barRows = sqlite
    .prepare(
      `SELECT instrument_id AS instrumentId, bar_date AS barDate, close, high, low
       FROM price_bars`,
    )
    .all() as BarRow[];

  const periodRows = new Map<number, PeriodRow[]>();
  for (const row of periods) {
    const list = periodRows.get(row.instrumentId) ?? [];
    list.push(row);
    periodRows.set(row.instrumentId, list);
  }
  const bars = new Map<number, PriceBarSnapshot[]>();
  for (const row of barRows) {
    const list = bars.get(row.instrumentId) ?? [];
    list.push({ barDate: row.barDate, close: row.close, high: row.high, low: row.low });
    bars.set(row.instrumentId, list);
  }
  const snapshots = new Map<number, StatementSnapshot[]>();
  for (const instrument of instruments) {
    snapshots.set(instrument.id, periodsToSnapshots(periodRows.get(instrument.id) ?? []));
  }
  const peers = instruments.map((instrument) => {
    const snaps = snapshots.get(instrument.id) ?? [];
    const annuals = snaps
      .filter((row) => row.statementType === "annual")
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const latest = annuals.length > 0 ? annuals[annuals.length - 1] : null;
    const closes = (bars.get(instrument.id) ?? [])
      .slice()
      .sort((a, b) => b.barDate.localeCompare(a.barDate));
    const close = closes[0] ?? null;
    return {
      ticker: instrument.ticker,
      name: instrument.name,
      listingStatus: instrument.listingStatus,
      instrumentType: instrument.instrumentType,
      researchProfile: storedProfile(instrument.researchProfile),
      industry: instrument.industry,
      sector: instrument.sector,
      lastClose: close?.close ?? null,
      lastCloseDate: close?.barDate ?? null,
      periodEnd: latest?.periodEnd ?? null,
      availableAt: latest?.availableAt ?? null,
      eps: latest?.eps ?? null,
      dividendPerShare: latest?.dividendPerShare ?? null,
      equity: latest?.equity ?? null,
      shares: latest?.shares ?? null,
      revenue: latest?.revenue ?? null,
      pat: latest?.pat ?? null,
    } satisfies PeerUniverseRow;
  });
  return {
    listed: instruments.filter((row) => row.listingStatus !== "inactive"),
    snapshots,
    bars,
    peers,
  };
}

function prepareRun(universe: StoredUniverse, ticker: string, asOf: string): PreparedRun {
  const instrument = universe.listed.find((row) => row.ticker.toUpperCase() === ticker);
  if (!instrument) refuse(`${ticker} is not a listed instrument in the disposable copy.`);
  const config = loadScoringConfig();
  const profile = resolveResearchProfile(
    instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
    instrument.ticker,
    { sector: instrument.sector, industry: instrument.industry },
    config,
  ).profile;
  const periods = universe.snapshots.get(instrument.id) ?? [];
  const result = calculateFairValue({
    ticker: instrument.ticker,
    researchProfile: profile,
    industry: instrument.industry,
    sector: instrument.sector,
    periods,
    bars: universe.bars.get(instrument.id) ?? [],
    peers: universe.peers,
    asOf,
  });
  const annuals = annualsFrom(periods);
  const quality = assessFairValueQuality(result, annuals);
  return { instrumentId: instrument.id, result, quality };
}

type StoredFairValueRow = {
  id: number;
  ticker: string;
  fair_value_base: number | null;
  calculated_at: string;
  quality_status: string | null;
  base_use: string | null;
  quality_version: string | null;
  observation_key: string | null;
  model_version: string;
};

function readFairValueRows(sqlite: Database.Database): StoredFairValueRow[] {
  return sqlite
    .prepare(
      `SELECT id, ticker, fair_value_base, calculated_at, quality_status, base_use,
              quality_version, observation_key, model_version
       FROM fair_value_runs
       ORDER BY id ASC`,
    )
    .all() as StoredFairValueRow[];
}

function sameBase(stored: number | null, calculated: number | null): boolean {
  if (stored == null || calculated == null) return stored == null && calculated == null;
  return stored === calculated;
}

function assertPersisted(row: StoredFairValueRow, prepared: PreparedRun, asOf: string) {
  if (row.ticker !== prepared.result.ticker) refuse(`Stored ticker ${row.ticker} does not match the request.`);
  if (row.calculated_at !== asOf) refuse(`calculated_at is ${row.calculated_at}, expected ${asOf}.`);
  if (row.quality_version !== FAIR_VALUE_QUALITY_VERSION) {
    refuse(`quality_version is ${String(row.quality_version)}.`);
  }
  if (row.quality_status !== prepared.quality.status || row.base_use !== prepared.quality.baseUse) {
    refuse("Stored quality status or base use does not match the assessment.");
  }
  if (row.model_version !== prepared.result.modelVersion) {
    refuse("Stored model version does not match the calculator result.");
  }
  if (!row.observation_key) refuse("observation_key was not stored.");
  if (!sameBase(row.fair_value_base, prepared.result.fairValueBase)) {
    refuse(
      `Stored base ${String(row.fair_value_base)} does not match calculator base ${String(prepared.result.fairValueBase)}.`,
    );
  }
}

async function main() {
  refuseEnvironment();
  const ticker = readTicker(process.argv);
  const livePath = resolveLiveDatabase();
  const source = new Database(livePath, { readonly: true, fileMustExist: true });
  let destDir: string | null = null;
  let copy: Database.Database | null = null;
  let report: Record<string, unknown> | null = null;
  try {
    const baseline = readLiveFacts(source, livePath);
    if (baseline.fairValueRuns !== 0) {
      refuse(`Live fair_value_runs count is ${baseline.fairValueRuns}. This validation expects 0.`);
    }
    if (baseline.listedCount < 1) refuse("Live database has no listed instruments.");

    destDir = createDisposableDirectory(livePath);
    const destPath = join(destDir, "research.db");
    if (resolve(destPath) === livePath) refuse("Backup destination resolved to the live database.");
    const backup = await source.backup(destPath);
    if (backup.remainingPages !== 0 || backup.totalPages < 1) {
      refuse(`SQLite backup did not finish (total ${backup.totalPages}, remaining ${backup.remainingPages}).`);
    }
    assertLiveUnchanged(source, livePath, baseline);

    const reader = new Database(destPath, { readonly: true, fileMustExist: true });
    let universe: StoredUniverse;
    let asOf: string;
    let first: PreparedRun;
    try {
      assertCopyReady(reader, destPath, livePath, baseline, false);
      universe = loadStoredUniverse(reader);
      asOf = new Date().toISOString();
      first = prepareRun(universe, ticker, asOf);
    } finally {
      reader.close();
    }

    assertLiveUnchanged(source, livePath, baseline);
    copy = new Database(destPath, { fileMustExist: true });
    copy.pragma("foreign_keys = ON");
    assertCopyReady(copy, destPath, livePath, baseline, true);
    assertLiveUnchanged(source, livePath, baseline);
    const inserted = insertFairValueRun(copy, {
      instrumentId: first.instrumentId,
      result: first.result,
      quality: first.quality,
      calculatedAt: asOf,
    });
    const afterFirst = readFairValueRows(copy);
    if (!inserted.inserted || afterFirst.length !== 1 || afterFirst[0]!.id !== inserted.id) {
      refuse("First persistence did not insert exactly one row.");
    }
    assertPersisted(afterFirst[0]!, first, asOf);

    const second = prepareRun(universe, ticker, asOf);
    const replayed = insertFairValueRun(copy, {
      instrumentId: second.instrumentId,
      result: second.result,
      quality: second.quality,
      calculatedAt: asOf,
    });
    const afterSecond = readFairValueRows(copy);
    if (
      replayed.inserted ||
      replayed.id !== inserted.id ||
      afterSecond.length !== 1 ||
      afterSecond[0]!.id !== inserted.id ||
      afterSecond[0]!.calculated_at !== asOf
    ) {
      refuse("Repeat run changed the existing row or inserted another observation.");
    }
    assertPersisted(afterSecond[0]!, second, asOf);
    assertLiveUnchanged(source, livePath, baseline);

    report = {
      kind: "fair-value-one-validation",
      ticker,
      asOf,
      liveDatabase: livePath,
      disposableDatabase: realpathSync(destPath),
      listedCount: baseline.listedCount,
      first: {
        id: inserted.id,
        inserted: true,
        calculatedAt: afterFirst[0]!.calculated_at,
        fairValueBase: afterFirst[0]!.fair_value_base,
        qualityStatus: afterFirst[0]!.quality_status,
        baseUse: afterFirst[0]!.base_use,
        qualityVersion: afterFirst[0]!.quality_version,
        modelVersion: afterFirst[0]!.model_version,
        observationKey: afterFirst[0]!.observation_key,
      },
      second: {
        id: replayed.id,
        inserted: false,
        calculatedAt: afterSecond[0]!.calculated_at,
        rowCount: afterSecond.length,
      },
      liveRecheck: {
        fairValueRuns: baseline.fairValueRuns,
        dataVersion: baseline.dataVersion,
        mainFileUnchanged: true,
        walUnchanged: true,
      },
      limitation: LIMITATION,
    };
  } finally {
    try {
      copy?.close();
    } catch {
      process.exitCode = 1;
    }
    try {
      source.close();
    } catch {
      process.exitCode = 1;
    }
    let disposableDeleted = false;
    if (destDir) {
      try {
        removeDisposableDir(destDir, livePath);
        disposableDeleted = true;
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      }
    }
    if (report) {
      report.disposableDeleted = disposableDeleted;
      console.log(JSON.stringify(report, null, 2));
    }
  }
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
