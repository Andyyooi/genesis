# Bursa research (Phase 4)

Personal Malaysian equity research tool for Andy Yooi. **Phase 4:** config-driven Research Score + Valuation Score. Not the full research page, scanner, news, alerts, AI, or export.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

## Scores

```bash
npm test
npm run scores -- MAYBANK
```

Debug page: [/scores/MAYBANK](http://127.0.0.1:43147/scores/MAYBANK)

Weights, thresholds, and factor sets live in `config/scoring.yaml`. Change a number there and re-run — scores change without code edits. News and technical stay **not in this run**; remaining category weights are renormalized. Unavailable factors are omitted (never zero). Potential Concerns are listed separately and do not change the Research Score.

## Metrics and ingest

```bash
npm run metrics -- MAYBANK
npm run ingest:fundamentals -- data/raw/fundamentals-sample.csv
npm run ingest:prices
```
