import { getSqlite } from "../src/db/client";
import { validateRefreshStages } from "../src/refresh/validate-publication";

const sqlite = getSqlite();
const startedAt = process.env.REFRESH_STARTED_AT ?? "";
const latest = sqlite.prepare("SELECT run_id FROM refresh_runs WHERE dataset = 'prices' ORDER BY id DESC LIMIT 1").get() as { run_id: string } | undefined;
const rows = sqlite.prepare("SELECT dataset, status, failed_count, json_extract(metadata_json, '$.requestsSucceeded') AS requested_succeeded_count, started_at FROM refresh_runs WHERE run_id = ?").all(latest?.run_id ?? "") as Parameters<typeof validateRefreshStages>[0];
validateRefreshStages(rows, startedAt);
const run = sqlite.prepare("SELECT id, as_of, summary_json FROM market_scan_runs ORDER BY id DESC LIMIT 1").get() as { id: number; as_of: string; summary_json: string } | undefined;
if (!run || Date.parse(run.as_of) < Date.parse(startedAt) || JSON.parse(run.summary_json).methodology !== "cross-sectional-v2") throw new Error("Fresh universe-wide percentile publication is required");
const listed = sqlite.prepare("SELECT COUNT(*) AS n FROM instruments WHERE listing_status IS NULL OR listing_status != 'inactive'").get() as { n: number };
const scored = sqlite.prepare("SELECT COUNT(*) AS n FROM market_scan_rows WHERE run_id = ?").get(run.id) as { n: number };
if (!listed.n || listed.n !== scored.n) throw new Error("Universe publication is incomplete");
console.log(`Validated prices, fundamentals, fair value and ${scored.n} published percentile results. Missing financial inputs remain unavailable, not invented.`);
