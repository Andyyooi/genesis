import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { isSnapshotReadOnly } from "@/lib/data-mode";

export const SNAPSHOT_GZ_REL = join("data", "snapshots", "research.db.gz");

export function snapshotGzPath() {
  return join(process.cwd(), SNAPSHOT_GZ_REL);
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
 */
export function resolveSqliteFile(): { path: string; readonly: boolean } {
  if (!isSnapshotReadOnly()) {
    const path = liveSqlitePath();
    refuseLiveResearchDatabaseInTests(path);
    mkdirSync(join(path, ".."), { recursive: true });
    return { path, readonly: false };
  }
  const gz = snapshotGzPath();
  if (!existsSync(gz)) {
    throw new Error(
      `Read-only snapshot missing at ${gz}. Run npm run snapshot:pack and commit data/snapshots/research.db.gz.`,
    );
  }
  const dest = join(tmpdir(), "bursa-research-snapshot.db");
  refuseLiveResearchDatabaseInTests(dest);
  const stamp = join(tmpdir(), "bursa-research-snapshot.stamp");
  const gzStat = statSync(gz);
  const token = `${gzStat.size}:${gzStat.mtimeMs}`;
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, "utf8") === token) {
    return { path: dest, readonly: true };
  }
  writeFileSync(dest, gunzipSync(readFileSync(gz)));
  writeFileSync(stamp, token);
  return { path: dest, readonly: true };
}
