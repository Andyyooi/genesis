import Database from "better-sqlite3";
import { join } from "node:path";
import { isProduction, type AuthEnvironment } from "@/auth/session";
import { storedTarget, targetKey, type AnalystTarget } from "./target";

interface AnalystTargetStore {
  list(ticker: string): Promise<AnalystTarget[]>;
  save(targets: AnalystTarget[]): Promise<void>;
}

const redisKey = (ticker: string) => `genesis:analyst-targets:v1:${ticker}`;

function decode(value: unknown): AnalystTarget[] {
  if (typeof value !== "string") return [];
  try {
    const target = storedTarget.safeParse(JSON.parse(value));
    return target.success ? [target.data] : [];
  } catch {
    return [];
  }
}

export function redisAnalystTargetStore(url: string, token: string, request = fetch): AnalystTargetStore {
  async function command(args: unknown[], transaction = false) {
    const response = await request(transaction ? `${url.replace(/\/$/, "")}/multi-exec` : url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Analyst target storage request failed");
    return response.json();
  }

  return {
    async list(ticker) {
      const { result } = await command(["HVALS", redisKey(ticker)]);
      if (!Array.isArray(result)) throw new Error("Invalid analyst target list");
      return result.flatMap(decode);
    },
    async save(targets) {
      const commands = targets.map((target) => ["HSET", redisKey(target.ticker), targetKey(target), JSON.stringify(target)]);
      const results = await command(commands, true);
      if (!Array.isArray(results) || results.length !== commands.length ||
          results.some((entry) => entry?.result !== 0 && entry?.result !== 1)) {
        throw new Error("Analyst target storage command failed");
      }
    },
  };
}

export function localAnalystTargetStore(path: string): AnalystTargetStore {
  function run<T>(fn: (db: Database.Database) => T): T {
    const db = new Database(path);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS analyst_targets (ticker TEXT NOT NULL, report TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (ticker, report))");
      return fn(db);
    } finally {
      db.close();
    }
  }

  return {
    async list(ticker) {
      return run((db) => db.prepare("SELECT target FROM analyst_targets WHERE ticker = ?").pluck().all(ticker).flatMap(decode));
    },
    async save(targets) {
      run((db) => {
        const upsert = db.prepare("INSERT INTO analyst_targets VALUES (?, ?, ?) ON CONFLICT(ticker, report) DO UPDATE SET target = excluded.target");
        db.transaction(() => {
          for (const target of targets) upsert.run(target.ticker, targetKey(target), JSON.stringify(target));
        })();
      });
    },
  };
}

type StorageEnvironment = AuthEnvironment & {
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export function getAnalystTargetStore(env: StorageEnvironment = process.env): AnalystTargetStore | null {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return redisAnalystTargetStore(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return redisAnalystTargetStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (isProduction(env)) return null;
  return localAnalystTargetStore(join(process.cwd(), "data/sqlite/analyst-targets.db"));
}

export const TARGET_STORE_UNCONFIGURED = "Analyst target storage isn't set up on this server.";
export const TARGET_STORE_UNAVAILABLE = "Analyst target storage isn't responding. Try again later.";
