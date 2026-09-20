# Bursa research (Phase 7)

Personal Malaysian equity research tool for Andy Yooi. **Phase 7:** watchlist dashboard and thin opportunity filters. Not news ingest, alerts, in-app AI, or backtesting.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

- Dashboard: [http://127.0.0.1:43147](http://127.0.0.1:43147)
- Research lists: `/?list=undervalued`, `quality`, `quality-value`, `improving`, `discounted`, `catalyst`
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK) · [KLCC (REIT)](http://127.0.0.1:43147/stock/KLCC)

Click a dashboard row to open the research page. Lists are research filters, not buy orders.

**Data lag:** stored sample fundamentals are FY2024. A score run dated 2026 does not mean FY2025/FY2026 numbers exist. The dashboard, research page, and exports show **fundamentals period** and **price as-of / last trade**.

Export routes (unchanged): `/export/MAYBANK/quick|full|json|csv`.

```bash
npm test
```

## Raw JSON shape (future chatbot)

`GET /export/{ticker}/json` is schema `bursa-research.score-export.v1`. A later in-app chatbot should consume the same `score` object (`ScoreResult`).

```text
{
  schema, disclaimer,
  instrument: { ticker, name, instrument_type (COMMON_STOCK | REIT), bursa_code, sector, pn17, currency },
  dates: { score_as_of, last_trade_date, fundamentals_period, lag_note },
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
