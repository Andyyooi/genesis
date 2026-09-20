# Bursa research (Phase 9)

Personal Malaysian equity research tool for Andy Yooi. **Phase 9:** in-app alerts (no email/push, no in-app AI, no backtesting).

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

- [Dashboard](http://127.0.0.1:43147) — Recent alerts
- [Alerts](http://127.0.0.1:43147/alerts)
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK)

Evaluate after ingest:

```bash
npm run ingest:announcements -- data/raw/announcements-sample.csv
npm run alerts
```

Alerts persist ticker, rule id, why (plain language + evidence), timestamps, and a link to `/stock/[ticker]`. If score history is thin or unchanged, a **documented demo prior score_run** is stored (same FY filings, not invented FY2025/FY2026 numbers) so a Research Score change can be shown.

**Data lag:** fundamentals period vs last trade stay labelled.

```bash
npm test
```
