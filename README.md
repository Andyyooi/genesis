# Bursa research (Phase 3)

Personal Malaysian equity research tool for Andy Yooi. **Phase 3:** snapshot metrics (no scores). No opportunity scanner, research-page product UI, news, alerts, AI, or export.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

## Metrics (Phase 3)

```bash
npm test
npm run metrics -- MAYBANK
```

Debug page: [/metrics/MAYBANK](http://127.0.0.1:43147/metrics/MAYBANK)

Functions live in `src/metrics/` and only read stored SQLite snapshots. Missing inputs stay **Data unavailable** (never zero). REITs skip industrial FCF/leverage formulas.

## Import data (Phase 2)

```bash
npm run ingest:fundamentals -- data/raw/fundamentals-sample.csv
npm run ingest:prices
```
