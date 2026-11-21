import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { isCliEntrypoint } from "@/cli/entrypoint";
import { liveSqlitePath } from "@/db/snapshot-file";
import { parseSnapshotPointer } from "@/snapshot/fetch";

function main() {
  const artifact = readFileSync("data/snapshots/research.db.gz");
  const sqlite = new Database(liveSqlitePath(), { readonly: true, fileMustExist: true });
  try {
    const dates = sqlite.prepare("SELECT MAX(bar_date) AS priceDate FROM price_bars").get() as { priceDate: string | null };
    const pointer = parseSnapshotPointer({
      commit: process.argv[2],
      sha256: createHash("sha256").update(artifact).digest("hex"),
      bytes: artifact.byteLength,
      publishedAt: new Date().toISOString(),
      priceDate: dates.priceDate,
    });
    writeFileSync("data/snapshot.json", `${JSON.stringify(pointer, null, 2)}\n`);
    console.log(`Snapshot pointer updated: ${pointer.commit}`);
  } finally {
    sqlite.close();
  }
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
