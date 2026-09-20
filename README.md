# Bursa research (Phase 10)

Personal Malaysian equity research tool for Andy Yooi. **Phase 10:** REIT factor profile and bank overlay, plus stored-flag filters. No in-app AI, no backtesting, no email alerts.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

- [Dashboard](http://127.0.0.1:43147) — watchlists, Shariah/REIT/board/cap filters
- [Alerts](http://127.0.0.1:43147/alerts)
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK) — bank overlay (P/B, ROE)
- [KLCC](http://127.0.0.1:43147/stock/KLCC) — REIT profile (DPU / book NAV / gearing)

**Profiles:** ordinary companies use `default`. REITs use `reit` (not industrial FCF or EV/EBITDA). MAYBANK, CIMB, and PBBANK use `bank`. Missing CSV lines stay unavailable — never invented.

**Data lag:** fundamentals period vs last trade stay labelled. Do not invent FY2025/FY2026 filings.

```bash
npm test
```
