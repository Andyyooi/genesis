# Bursa research (Phase 1)

Personal Malaysian equity research tool for Andy Yooi. **Phase 1 only:** SQLite schema, YAML config, and a local ticker list. No scoring, ingest, research pages, news, alerts, AI, or export.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147). SQLite is created at `data/sqlite/research.db` (gitignored).

## What you should see

A watchlist table seeded from `config/universe.yaml` (11 Bursa names: 8 common stocks, 3 REITs). Last price shows **Data unavailable** — prices are not invented. PN17 names would show a **higher-risk** badge; none are seeded.

Edit `config/universe.yaml` and refresh to upsert tickers. Allowed `instrument_type` values: `COMMON_STOCK` and `REIT`. Warrants and ETFs are rejected on load.

## Config hooks (scoring not implemented)

- `config/scoring.yaml` — category weights (must sum to 100) and **instrument profiles** `default` and `reit`.
- `getFactorProfile(instrument_type)` in `src/config/load-scoring.ts` selects the profile. REITs must not use the ordinary-company factor set later.

## Layout

```text
config/           scoring.yaml, universe.yaml
data/sqlite/      local database file
src/app/          ticker list page
src/config/       YAML load + validation
src/db/           Drizzle schema and seed
src/lib/          MYR formatting helper
```
