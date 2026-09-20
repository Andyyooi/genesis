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
- [MAYBANK](http://127.0.0.1:43147/stock/MAYBANK) — bank overlay (P/B, ROE)
- [KLCC](http://127.0.0.1:43147/stock/KLCC) — REIT profile (DPU / book NAV / gearing)

**Profiles:** ordinary companies use `default`. REITs use `reit` (not industrial FCF or EV/EBITDA). MAYBANK, CIMB, and PBBANK use `bank`. Missing CSV lines stay unavailable — never invented.

**Data lag:** fundamentals period vs last trade stay labelled. Do not invent FY2025/FY2026 filings.

```bash
npm test
```
