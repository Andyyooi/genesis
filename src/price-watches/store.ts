import Database from "better-sqlite3";
import { join } from "node:path";
import { isProduction, type AuthEnvironment } from "@/auth/session";
import { savedWatch, type PriceWatch } from "./watch";

interface PriceWatchStore {
  get(ticker: string): Promise<PriceWatch | null>;
  list(): Promise<PriceWatch[]>;
  save(watch: PriceWatch): Promise<void>;
  remove(ticker: string): Promise<void>;
}

const REDIS_KEY = "genesis:price-watches:v1";

function decode(value: unknown): PriceWatch {
  if (typeof value !== "string") throw new Error("Invalid price watch");
  return savedWatch.parse(JSON.parse(value));
}

export function redisPriceWatchStore(url: string, token: string, request = fetch): PriceWatchStore {
  async function command(...args: string[]): Promise<unknown> {
    const response = await request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("Price watch storage request failed");
    const body = await response.json();
    if (!body || body.error || !Object.hasOwn(body, "result")) throw new Error("Price watch storage command failed");
    return body.result;
  }
  return {
    async get(ticker) {
      const value = await command("HGET", REDIS_KEY, ticker);
      return value === null ? null : decode(value);
    },
    async list() {
      const values = await command("HVALS", REDIS_KEY);
      if (!Array.isArray(values)) throw new Error("Invalid price watch list");
      return values.map(decode);
    },
    async save(watch) {
      await command("HSET", REDIS_KEY, watch.ticker, JSON.stringify(watch));
    },
    async remove(ticker) {
      await command("HDEL", REDIS_KEY, ticker);
    },
  };
}

export function localPriceWatchStore(path: string): PriceWatchStore {
  function run<T>(fn: (db: Database.Database) => T): T {
    const db = new Database(path);
    try {
      db.exec("CREATE TABLE IF NOT EXISTS price_watches (ticker TEXT PRIMARY KEY, watch TEXT NOT NULL)");
      return fn(db);
    } finally {
      db.close();
    }
  }
  return {
    async get(ticker) {
      return run((db) => {
        const row = db.prepare("SELECT watch FROM price_watches WHERE ticker = ?").pluck().get(ticker);
        return row === undefined ? null : decode(row);
      });
    },
    async list() {
      return run((db) => db.prepare("SELECT watch FROM price_watches").pluck().all().map(decode));
    },
    async save(watch) {
      run((db) => db.prepare("INSERT INTO price_watches (ticker, watch) VALUES (?, ?) ON CONFLICT(ticker) DO UPDATE SET watch = excluded.watch")
        .run(watch.ticker, JSON.stringify(watch)));
    },
    async remove(ticker) {
      run((db) => db.prepare("DELETE FROM price_watches WHERE ticker = ?").run(ticker));
    },
  };
}

type PriceWatchEnvironment = AuthEnvironment & {
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export function getPriceWatchStore(env: PriceWatchEnvironment = process.env): PriceWatchStore | null {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return redisPriceWatchStore(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return redisPriceWatchStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (isProduction(env)) return null;
  return localPriceWatchStore(join(process.cwd(), "data/sqlite/price-watches.db"));
}

export const WATCH_STORE_UNCONFIGURED = "Price watches aren’t set up on this server.";
export const WATCH_STORE_UNAVAILABLE = "Price watch storage isn’t responding. Try again later.";
