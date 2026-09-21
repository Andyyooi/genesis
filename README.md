# Bursa research (Phase 10)

Personal Malaysian equity research tool for Andy Yooi. **Phase 10:** REIT factor profile and bank overlay, plus stored-flag filters. No in-app AI, no backtesting, no email alerts.

## Run locally

```bash
npm install
npm run dev
```

Binds **0.0.0.0:43147**. Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

### Keep the preview up (restarts if Next exits)

```bash
npm run dev:persist
```

That is a small bash loop around `npm run dev`. It writes `data/.dev-persist.pid`. Confirm it is up:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:43147/
cat data/.dev-persist.pid
```

Stop:

```bash
kill "$(cat data/.dev-persist.pid)"
```

Or `Ctrl-C` if it is in the foreground. Do not start a second persist while one is already bound to 43147.

- [Dashboard](http://127.0.0.1:43147) — watchlists, Shariah/REIT/board/cap filters
- [Alerts](http://127.0.0.1:43147/alerts)
- [Market scan](http://127.0.0.1:43147/market) — last `npm run market:scan` (not a buy list)
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK) — bank overlay (P/B, ROE)
- [KLCC](http://127.0.0.1:43147/stock/KLCC) — REIT profile (DPU / book NAV / gearing)

**Profiles:** ordinary companies use `default`. REITs use `reit` (not industrial FCF or EV/EBITDA). Banks use `bank`. Missing CSV lines stay unavailable — never invented. The headline **Valuation Score** is unchanged; research pages also show **Historical Context** and **Peer Context** (Positive / Neutral / Negative / Unavailable) versus own period-end history and a constructed peer set. Those labels are not blended into a new overall score. Historical series is period-end price vs that year’s earnings when filing dates are unknown — not look-ahead-safe PIT P/E.

## Data (daily prices ≠ Cursor usage)

Yahoo **end-of-day** prices for `config/universe.yaml` can refresh on this VM once a day. That loop is ordinary Node/bash on the machine. **It does not use Cursor usage.** Cursor usage is only when an agent/chat is running.

This is **not** live/tick data. Default: run `npm run ingest:prices`, then sleep until **18:00 Malaysia time**, never sooner than **12 hours** after the last run (Bursa is closed by then; Yahoo EOD is usually on the tape). Missed symbols stay on the import report. **Prices are never invented.**

```bash
npm run ingest:prices          # one-off, same as always
npm run ingest:prices:daily    # keep-alive loop on this VM
```

Confirm / stop the daily loop:

```bash
cat data/.prices-daily.pid
cat data/logs/prices-daily.last.json
kill "$(cat data/.prices-daily.pid)"
```

**Fundamentals stay CSV.** We will **not** auto-fill ~30 names’ full financials from Yahoo, scrape Bursa, or invent FY2025/FY2026 statements. Filing lag vs live prices stays labelled.

Add coverage by hand:

1. A `COMMON_STOCK` or `REIT` row in `config/universe.yaml` (`yahoo_ticker` like `1155.KL`).
2. Annual (and optional interim) lines in `data/raw/fundamentals-sample.csv` or your own CSV — copy `data/raw/fundamentals-template.csv`. Empty cells stay unavailable.
3. `npm run ingest:fundamentals -- path/to.csv` then `npm run ingest:prices` (or wait for the daily job).

Announcements are the same pattern (`announcements-template.csv`). No in-app AI.

### Market-wide scan

```bash
npm run market:scan
```

Refreshes COMMON_STOCK + REIT from the **Yahoo Malaysia equity screener** (not a hand-typed Bursa list), pulls EOD prices (resumable, per-ticker failures), fills Yahoo annual statements where present, keeps CSV filings, scores everyone, writes data-quality + scanner lists to SQLite. Open `/market`. Slow (rate limits). **Not Cursor usage.** Warrants/ETFs excluded. PN17 only if already stored. Watchlist dashboard still uses `universe.yaml`. Daily `ingest:prices:daily` keeps running on whatever is in the DB.

Yahoo **quoteSummary** income years were incomplete (no balance sheet fields; ~244 names empty). Ingest now uses Yahoo **fundamentals-timeseries** annual series, fills nulls without overwriting history, and writes a quality snapshot.

```bash
npm run fundamentals:yahoo    # pull annuals (Yahoo only; not Cursor usage)
npm run fundamentals:report   # coverage / freshness / failure codes
```

After changing scoring or Data Confidence, refresh scan rows without Yahoo:

```bash
npm run market:rescore
```

Research, dashboard, exports, and `/market` show **Data Coverage**, **Freshness**, and **Data Confidence**. Raw Research and Valuation numbers are not rewritten for GENERAL. `research_profile` (GENERAL / BANK / REIT / OTHER_FINANCIAL / UNKNOWN) is stored separately from `instrument_type`.

```bash
npm run profiles:classify
```

```bash
npm test
```
