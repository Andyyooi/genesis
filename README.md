# Bursa research (Phase 5)

Personal Malaysian equity research tool for Andy Yooi. **Phase 5:** stock research page (English, MYR). Not export, scanner, news ingest, alerts, AI, or backtesting.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Research pages:

- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK)
- [KLCC (REIT)](http://127.0.0.1:43147/stock/KLCC)

Click a category, then a factor, to see inputs, formula, and period. Scores come from `config/scoring.yaml`. Missing data stays **Data unavailable**.

```bash
npm test
```
