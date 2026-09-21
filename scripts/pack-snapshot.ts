import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { getSqlite } from "@/db/client";

async function main() {
  const sqlite = getSqlite();
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const src = join(process.cwd(), "data", "sqlite", "research.db");
  const destDir = join(process.cwd(), "data", "snapshots");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "research.db.gz");
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest));
  console.log(JSON.stringify({ kind: "snapshot", src, dest }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
