import { mkdtempSync, rmSync, statSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateSqliteSchema } from "@/db/client";
import { RUNTIME_SNAPSHOT_MAX_BYTES } from "@/db/snapshot-file";
import { assertSnapshotFitsRuntime, gunzipSqlite, gzipSqlite, prepareRuntimeSnapshot } from "@/snapshot/compact";

describe("deployment snapshot compaction", () => {
  it("preserves current evidence and historical scores without changing the input snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-compact-test-"));
    try {
      const source = join(dir, "source.db");
      const sourceGz = join(dir, "source.db.gz");
      const output = join(dir, "runtime.db.gz");
      const unpacked = join(dir, "runtime.db");
      const sqlite = new Database(source);
      migrateSqliteSchema(sqlite);
      sqlite.exec(`
        INSERT INTO instruments (id, ticker, name, instrument_type, created_at, updated_at)
        VALUES (1, 'ONE', 'One', 'COMMON_STOCK', 'old', 'old'),
               (2, 'TWO', 'Two', 'COMMON_STOCK', 'old', 'old');
        INSERT INTO market_scan_runs (as_of, summary_json, created_at)
        VALUES ('publication', '{}', 'publication');
        INSERT INTO score_runs (instrument_id, as_of, research_score, evidence_json, valuation_context_json, created_at)
        VALUES (1, 'old', 60, hex(randomblob(300000)), '{}', 'old'),
               (1, 'publication', 65, 'picks evidence', '{}', 'publication'),
               (1, 'newer', 71, 'latest evidence', '{}', 'newer'),
               (2, 'old', 75, 'only evidence', '{}', 'old');
      `);
      sqlite.close();
      await gzipSqlite(source, sourceGz);
      const result = await prepareRuntimeSnapshot(sourceGz, output);
      expect(result.bytes).toBeLessThan(statSync(sourceGz).size);
      expect(result.unpackedBytes).toBeLessThan(statSync(source).size);
      await gunzipSqlite(output, unpacked);
      const rows = new Database(unpacked, { readonly: true });
      try {
        expect(rows.prepare("SELECT research_score, evidence_json, valuation_context_json FROM score_runs ORDER BY id").all())
          .toEqual([
            { research_score: 60, evidence_json: null, valuation_context_json: null },
            { research_score: 65, evidence_json: "picks evidence", valuation_context_json: "{}" },
            { research_score: 71, evidence_json: "latest evidence", valuation_context_json: "{}" },
            { research_score: 75, evidence_json: "only evidence", valuation_context_json: "{}" },
          ]);
      } finally {
        rows.close();
      }
      await gunzipSqlite(sourceGz, unpacked);
      expect(statSync(unpacked).size).toBe(statSync(source).size);
      await expect(prepareRuntimeSnapshot(output, join(dir, "again.db.gz"))).resolves.toEqual(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a database over the deployment budget before loading it into memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "genesis-budget-test-"));
    try {
      const image = join(dir, "image.db");
      new Database(image).close();
      truncateSync(image, RUNTIME_SNAPSHOT_MAX_BYTES + 1);
      expect(() => assertSnapshotFitsRuntime(image)).toThrow(/deployment budget/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
