import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { isSnapshotReadOnly } from "@/lib/data-mode";

export const SNAPSHOT_GZ_REL = join("data", "snapshots", "research.db.gz");

export function snapshotGzPath() {
  return join(process.cwd(), SNAPSHOT_GZ_REL);
}

export function liveSqlitePath() {
  if (process.env.BURSA_SQLITE_PATH?.trim()) {
    return process.env.BURSA_SQLITE_PATH.trim();
  }
  return join(process.cwd(), "data", "sqlite", "research.db");
}

/**
 * Local writable DB, or a /tmp copy of the committed gzip snapshot (read-only).
 * Vercel cannot persist SQLite writes; /tmp is per-instance only.
 * Tests may set BURSA_SQLITE_PATH to an isolated file.
 */
export function resolveSqliteFile(): { path: string; readonly: boolean } {
  if (!isSnapshotReadOnly()) {
    const path = liveSqlitePath();
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
