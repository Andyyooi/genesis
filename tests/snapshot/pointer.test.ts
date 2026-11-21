import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tsx = resolve("node_modules/.bin/tsx");
const tsconfig = resolve("tsconfig.json");
const script = resolve("scripts/write-snapshot-pointer.ts");
const commit = "a".repeat(40);
const artifact = Buffer.from("packed snapshot");
const dirs: string[] = [];

function fixture(withPrices = true) {
  const root = mkdtempSync(join(tmpdir(), "snapshot-pointer-"));
  dirs.push(root);
  mkdirSync(join(root, "data", "snapshots"), { recursive: true });
  writeFileSync(join(root, "data", "snapshots", "research.db.gz"), artifact);
  const target = join(root, "data", "snapshot.json");
  writeFileSync(target, "previous pointer\n");
  const source = join(root, "source.db");
  const sqlite = new Database(source);
  sqlite.exec("CREATE TABLE price_bars (bar_date TEXT)");
  if (withPrices) sqlite.exec("INSERT INTO price_bars VALUES ('2026-09-24'), ('2026-09-25')");
  sqlite.close();
  const run = (sha = commit) => execFileSync(tsx, ["--tsconfig", tsconfig, script, sha], {
    cwd: root,
    env: { ...process.env, BURSA_SQLITE_PATH: source },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { target, run };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("snapshot pointer generation", () => {
  it("records the data SHA, actual artifact digest and size, publication time and latest price date", () => {
    const { target, run } = fixture();
    run();
    const pointer = JSON.parse(readFileSync(target, "utf8"));
    expect(pointer).toEqual({
      commit,
      sha256: createHash("sha256").update(artifact).digest("hex"),
      bytes: artifact.length,
      publishedAt: expect.any(String),
      priceDate: "2026-09-25",
    });
    expect(Number.isFinite(Date.parse(pointer.publishedAt))).toBe(true);
  });

  it("refuses empty price data without overwriting the pointer", () => {
    const { target, run } = fixture(false);
    expect(() => run()).toThrow("Invalid snapshot pointer");
    expect(readFileSync(target, "utf8")).toBe("previous pointer\n");
  });

  it("refuses an invalid data commit without overwriting the pointer", () => {
    const { target, run } = fixture();
    expect(() => run("data-snapshot")).toThrow("Invalid snapshot pointer");
    expect(readFileSync(target, "utf8")).toBe("previous pointer\n");
  });
});
