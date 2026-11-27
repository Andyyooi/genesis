import { copyFile, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import Database from "better-sqlite3";
import { RUNTIME_SNAPSHOT_MAX_BYTES } from "@/db/snapshot-file";

const MAX_COMPRESSED_BYTES = 95 * 1024 * 1024;

// Keep the score timeline, the latest full result per stock, and the evidence
// used by Top Picks for the current market publication.
export function compactScoreHistory(imagePath: string) {
  const sqlite = new Database(imagePath, { fileMustExist: true });
  try {
    const { changes } = sqlite.prepare(`
      UPDATE score_runs
      SET evidence_json = NULL, valuation_context_json = NULL
      WHERE (evidence_json IS NOT NULL OR valuation_context_json IS NOT NULL)
        AND id NOT IN (SELECT MAX(id) FROM score_runs GROUP BY instrument_id)
        AND as_of IS NOT (SELECT as_of FROM market_scan_runs ORDER BY id DESC LIMIT 1)
    `).run();
    if (changes > 0) sqlite.exec("VACUUM");
    return changes;
  } finally {
    sqlite.close();
  }
}

export function assertSnapshotFitsRuntime(imagePath: string, compressedPath?: string) {
  const rawBytes = statSync(imagePath).size;
  if (rawBytes > RUNTIME_SNAPSHOT_MAX_BYTES) {
    throw new Error(`Snapshot is ${rawBytes} bytes unpacked; deployment budget is ${RUNTIME_SNAPSHOT_MAX_BYTES} bytes.`);
  }
  if (compressedPath && statSync(compressedPath).size > MAX_COMPRESSED_BYTES) {
    throw new Error(`Compressed snapshot exceeds the ${MAX_COMPRESSED_BYTES}-byte GitHub upload budget.`);
  }
}

export function gzipSqlite(sourcePath: string, destPath: string) {
  return pipeline(createReadStream(sourcePath), createGzip({ level: 9 }), createWriteStream(destPath));
}

export function gunzipSqlite(sourcePath: string, destPath: string) {
  return pipeline(createReadStream(sourcePath), createGunzip(), createWriteStream(destPath));
}

export async function prepareRuntimeSnapshot(sourcePath: string, runtimePath: string) {
  const work = await mkdtemp(join(tmpdir(), "genesis-runtime-"));
  const partial = `${runtimePath}.${randomUUID()}.partial`;
  try {
    const imagePath = join(work, "image.db");
    await gunzipSqlite(sourcePath, imagePath);
    const stripped = compactScoreHistory(imagePath);
    assertSnapshotFitsRuntime(imagePath);
    if (stripped) await gzipSqlite(imagePath, partial);
    else await copyFile(sourcePath, partial);
    assertSnapshotFitsRuntime(imagePath, partial);
    await rename(partial, runtimePath);
    return { bytes: (await stat(runtimePath)).size, unpackedBytes: (await stat(imagePath)).size };
  } finally {
    await Promise.all([rm(partial, { force: true }), rm(work, { recursive: true, force: true })]);
  }
}
