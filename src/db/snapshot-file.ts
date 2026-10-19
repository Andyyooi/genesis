import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { isSnapshotReadOnly } from "@/lib/data-mode";

export const SNAPSHOT_GZ_REL = join("data", "snapshots", "research.db.gz");

export function snapshotGzPath() {
  const configured = process.env.BURSA_SNAPSHOT_GZ_PATH?.trim();
  if (configured) {
    // Candidate preview paths are absolute temp files, not the committed snapshot.
    return resolve(/*turbopackIgnore: true*/ configured);
  }
  return join(process.cwd(), "data", "snapshots", "research.db.gz");
}

export function defaultLiveSqlitePath() {
  return join(process.cwd(), "data", "sqlite", "research.db");
}

export function liveSqlitePath() {
  if (process.env.BURSA_SQLITE_PATH?.trim()) {
    return process.env.BURSA_SQLITE_PATH.trim();
  }
  return defaultLiveSqlitePath();
}

function canonicalSqlitePath(filePath: string) {
  const absolute = resolve(filePath);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** True when `filePath` is the on-disk research database, including a relative path to it. */
export function targetsLiveResearchDatabase(filePath: string) {
  if (filePath === ":memory:" || filePath.trim() === "") return false;
  return canonicalSqlitePath(filePath) === canonicalSqlitePath(defaultLiveSqlitePath());
}

export function refuseLiveResearchDatabase(filePath: string) {
  if (!targetsLiveResearchDatabase(filePath)) return;
  throw new Error(
    `Refusing to open the live research database during tests (${filePath}). Set BURSA_SQLITE_PATH to an isolated temporary file.`,
  );
}

function refuseLiveResearchDatabaseInTests(filePath: string) {
  if (process.env.VITEST !== "true") return;
  refuseLiveResearchDatabase(filePath);
}

/**
 * Local writable DB, or a /tmp copy of the committed gzip snapshot (read-only).
 * Vercel cannot persist SQLite writes; /tmp is per-instance only.
 * Tests may set BURSA_SQLITE_PATH to an isolated file.
 * Preview a candidate with BURSA_SNAPSHOT_READONLY=1 and BURSA_SNAPSHOT_GZ_PATH=<candidate.gz>.
 */
export function resolveSqliteFile(): { path: string; readonly: boolean } {
  if (!isSnapshotReadOnly()) {
    const path = liveSqlitePath();
    refuseLiveResearchDatabaseInTests(path);
    mkdirSync(join(path, ".."), { recursive: true });
    return { path, readonly: false };
  }
  const configuredGz = process.env.BURSA_SNAPSHOT_GZ_PATH?.trim();
  // Keep the production path statically scoped so Turbopack does not trace the whole project.
  const gz = configuredGz
    ? resolve(/*turbopackIgnore: true*/ configuredGz)
    : join(process.cwd(), "data", "snapshots", "research.db.gz");
  if (!existsSync(/*turbopackIgnore: true*/ gz)) {
    throw new Error(
      `Read-only snapshot missing at ${gz}. Run npm run snapshot:pack and commit data/snapshots/research.db.gz.`,
    );
  }
  // Candidate paths use an isolated /tmp copy so they never collide with the committed snapshot cache.
  const cacheKey = configuredGz
    ? createHash("sha256").update(gz).digest("hex").slice(0, 16)
    : "default";
  const dest = join(tmpdir(), `bursa-research-snapshot-${cacheKey}.db`);
  refuseLiveResearchDatabaseInTests(dest);
  const stamp = join(tmpdir(), `bursa-research-snapshot-${cacheKey}.stamp`);
  const gzStat = statSync(/*turbopackIgnore: true*/ gz);
  const token = `${gzStat.size}:${gzStat.mtimeMs}`;
  if (
    existsSync(/*turbopackIgnore: true*/ dest) &&
    existsSync(/*turbopackIgnore: true*/ stamp) &&
    readFileSync(/*turbopackIgnore: true*/ stamp, "utf8") === token
  ) {
    return { path: dest, readonly: true };
  }
  writeFileSync(/*turbopackIgnore: true*/ dest, gunzipSync(readFileSync(/*turbopackIgnore: true*/ gz)));
  writeFileSync(/*turbopackIgnore: true*/ stamp, token);
  return { path: dest, readonly: true };
}
