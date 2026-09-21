/**
 * Local: writable data/sqlite/research.db
 * Vercel / BURSA_SNAPSHOT_READONLY: gunzip bundled snapshot to /tmp, open read-only.
 * Vercel’s filesystem is ephemeral — a git-tracked .db would not persist writes anyway.
 */
export function isSnapshotReadOnly(): boolean {
  return process.env.VERCEL === "1" || process.env.BURSA_SNAPSHOT_READONLY === "1";
}

export function refuseSnapshotWrites(action: string): boolean {
  if (!isSnapshotReadOnly()) return false;
  console.error(`Refusing ${action}: this process uses a read-only SQLite snapshot (Vercel or BURSA_SNAPSHOT_READONLY).`);
  return true;
}
