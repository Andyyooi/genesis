# Bursa research (Phase 6)

Personal Malaysian equity research tool for Andy Yooi. **Phase 6:** ChatGPT export from the stock research page (Quick Markdown, Full Markdown, Raw JSON + CSV). Not dashboard/scanner, news ingest, alerts, in-app AI, or backtesting.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Research pages with export:

- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK)
- [KLCC (REIT)](http://127.0.0.1:43147/stock/KLCC)

Use **Export for ChatGPT** on the page (download or copy). Direct routes:

| Kind | Route | File |
| --- | --- | --- |
| Quick report | `/export/MAYBANK/quick` | `MAYBANK-quick.md` |
| Full research report | `/export/MAYBANK/full` | `MAYBANK-full.md` |
| Raw JSON | `/export/MAYBANK/json` | `MAYBANK-raw.json` |
| Tables CSV | `/export/MAYBANK/csv` | `MAYBANK-tables.csv` |

The Full report includes factor **evidence**, category **coverage**, financials with dates/sources, actual vs estimate, and labels missing values as unavailable. It does not use BUY/SELL language. REIT tickers export the **reit** scoring profile, not industrial FCF/EV/EBITDA factors.

```bash
npm test
```

## Raw JSON shape (future chatbot)

`GET /export/{ticker}/json` is schema `bursa-research.score-export.v1`. A later in-app chatbot should consume the same `score` object (`ScoreResult`).

```text
{
  schema, disclaimer,
  instrument: { ticker, name, instrument_type (COMMON_STOCK | REIT), bursa_code, sector, pn17, currency },
  score: ScoreResult {
    asOf, configHash, profile (default | reit),
    researchScore, valuationScore,
    categories: [{ id, configuredWeight, liveWeight, score, coverage, inThisRun, warning, factors: [evidence] }],
    concerns, notes
  },
  metrics: [{ id, label, value | null, available, period, formula, … }],
  financial_periods: [{ period_end, available_at, retrieved_at, statement_type, source, actual_or_estimate, line_items }]
}
```

Nulls and `"Data unavailable"` mean the number was not stored. They are never filled from peers or invented. `instrument_type` selects `default` vs `reit` factor sets.
