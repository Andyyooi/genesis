import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
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

export function resolveSqliteSource(): { path: string; readonly: false } | { buffer: Buffer; readonly: true } {
  if (!isSnapshotReadOnly()) {
    const path = liveSqlitePath();
    refuseLiveResearchDatabaseInTests(path);
    mkdirSync(join(path, ".."), { recursive: true });
    return { path, readonly: false };
  }
  const gz = snapshotGzPath();
  if (!existsSync(/*turbopackIgnore: true*/ gz)) {
    throw new Error(
      `Read-only snapshot missing at ${gz}. Run npm run snapshot:fetch before starting the app.`,
    );
  }
  const compressed = readFileSync(/*turbopackIgnore: true*/ gz);
  const bytes = compressed.length >= 18 ? compressed.readUInt32LE(compressed.length - 4) : 0;
  // Inflate into one chunk; SQLite makes a second full copy when it opens the buffer.
  if (bytes < 100 || bytes > 800 * 1024 * 1024) {
    throw new Error(`Snapshot size ${bytes} bytes is outside the in-memory SQLite budget.`);
  }
  const buffer = gunzipSync(compressed, { chunkSize: bytes + 1, maxOutputLength: bytes });
  if (buffer.length !== bytes || buffer.toString("ascii", 0, 16) !== "SQLite format 3\0") {
    throw new Error("Invalid SQLite snapshot image.");
  }
  // The backup contains all committed pages. SQLite cannot deserialize a WAL-mode image.
  if (buffer[18] === 2 && buffer[19] === 2) buffer[18] = buffer[19] = 1;
  return { buffer, readonly: true };
}
