# Bursa research (Phase 2)

Personal Malaysian equity research tool for Andy Yooi. **Phase 2:** watchlist, CSV fundamentals ingest, Yahoo EOD prices. No scoring, research pages, news, alerts, AI, or export.

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147). SQLite is created at `data/sqlite/research.db` (gitignored).

## Import data

Template (empty row to copy): `data/raw/fundamentals-template.csv`

Sample with several years of **MAYBANK** and **TENAGA** from published annual figures, plus rows that *should* be rejected: `data/raw/fundamentals-sample.csv`

```bash
npm run ingest:fundamentals -- data/raw/fundamentals-sample.csv
npm run ingest:prices
```

Or both: `npm run ingest`

- CSV rows missing ticker or period_end are **rejected** (see `/ingest`). Numbers are never invented; blank cells stay unavailable.
- Re-importing the same ticker + period_end + statement_type + source **updates** the row instead of duplicating it.
- Prices come only from Yahoo (`XXXX.KL` in `config/universe.yaml`). A miss is listed on `/ingest` — no fake bars.
- Open a ticker (try MAYBANK) to inspect stored periods and the latest price bars, including **last trade date**.

`unit` in the CSV multiplies statement amounts (revenue, PAT, equity, debt, cash, OCF, capex) into MYR. EPS, dividend per share, and share count are not multiplied.

## Config

- `config/universe.yaml` — ~30 COMMON_STOCK + REIT names; Bursa code and Yahoo `.KL` mapping; optional `pn17` warning flag.
- `config/scoring.yaml` — weights and `default` / `reit` profile stubs (scoring is still Phase 4).
