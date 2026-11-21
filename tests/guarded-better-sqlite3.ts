import { createRequire } from "node:module";
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { refuseLiveResearchDatabase } from "@/db/snapshot-file";

const require = createRequire(resolve(process.cwd(), "package.json"));
const Real = require(["better", "sqlite3"].join("-")) as typeof BetterSqlite3;

function GuardedDatabase(
  filename?: string | Buffer,
  options?: BetterSqlite3.Options,
): BetterSqlite3.Database {
  if (typeof filename === "string") refuseLiveResearchDatabase(filename);
  return new Real(filename as string, options);
}

Object.assign(GuardedDatabase, Real, { genesisTestGuard: true });

export default GuardedDatabase as unknown as typeof BetterSqlite3;
