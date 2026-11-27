import Database from "better-sqlite3";
import { join } from "node:path";
import { isProduction, type AuthEnvironment } from "@/auth/session";
import { redisCommand, redisCredentials } from "@/lib/redis-rest";
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
  const command = redisCommand(url, token, request, "Price watch storage");
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

export function getPriceWatchStore(env: AuthEnvironment & Parameters<typeof redisCredentials>[0] = process.env): PriceWatchStore | null {
  const credentials = redisCredentials(env);
  if (credentials) return redisPriceWatchStore(credentials.url, credentials.token);
  if (isProduction(env)) return null;
  return localPriceWatchStore(join(process.cwd(), "data/sqlite/price-watches.db"));
}

export const WATCH_STORE_UNCONFIGURED = "Price watches aren’t set up on this server.";
export const WATCH_STORE_UNAVAILABLE = "Price watch storage isn’t responding. Try again later.";
