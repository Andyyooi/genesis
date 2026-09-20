# Bursa research (Phase 8)

Personal Malaysian equity research tool for Andy Yooi. **Phase 8:** CSV news/announcements ingest, research-page news, Catalyst Watch. Not alerts, in-app AI, or backtesting. Not Bursa scraping.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

Import announcements (same pattern as fundamentals):

```bash
npm run ingest:announcements -- data/raw/announcements-sample.csv
```

Template: `data/raw/announcements-template.csv`. Rejected rows (missing ticker, date, or headline) show on [Import report](http://127.0.0.1:43147/ingest).

- Dashboard: [http://127.0.0.1:43147](http://127.0.0.1:43147) · Catalyst Watch: `/?list=catalyst`
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK) news section links to the original company URL
- [KLCC](http://127.0.0.1:43147/stock/KLCC)

News category weight (10%) **only enters the live Research Score when stored announcements exist**. Otherwise it stays omitted and remaining weights are renormalized — not filled with a fake 50. Technical is still unavailable.

**Data lag:** FY2024 filings vs live prices stay labelled. Do not invent FY2025/FY2026 numbers.

```bash
npm test
```
