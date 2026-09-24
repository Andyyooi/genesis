# Phase 18B — Daily Market Refresh Pipeline

**Status:** Implemented (manual local refresh). Production scheduler documented, not enabled.  
**Checkpoint base:** `ffd2b2e` (CAGR NaN fix) + Phase 18 source strategy.  
**Universe scale:** ~1,058 listed instruments in packed research DB.  
**Constraint:** News/events remain display-only; scoring methodology unchanged.

---

## 1. Product requirement

Genesis refreshes research data **once per day after Bursa closes** (`Asia/Kuala_Lumpur`). Opening the app should show the **last successfully ingested** session — not live ticks.

Hierarchy of truth:

```text
Fresh verified data
  → Existing valid data with known age
    → Unavailable
      → NEVER fabricated / zero-filled
```

---

## 2. Architecture map (existing + 18B)

### Prices

```text
Yahoo chart API
  → importYahooPrices (src/ingest/import-prices.ts)
  → upsert price_bars (instrument_id, bar_date, source)
  → ingest_reports + refresh_runs(prices)
  → scoreTicker / metrics (last_close, 52w, …)
  → UI
```

Failures skip that ticker; **prior bars remain**.

### Fundamentals

```text
Yahoo fundamentals-timeseries (+ optional secondary stub)
  → importYahooFundamentals
  → persistAnnualPeriod (fill nulls only; never wipe history)
  → financial_periods
  → refresh_runs(fundamentals)
  → scoring / UI
```

Unchanged annuals count as **UNCHANGED**, not a fake “new” statement.

### Structured events

```text
EventSourceProvider
  → (Phase 16) CuratedFixtureEventProvider OR UnavailableLiveBursaEventProvider
  → events table
  → UI Recent Events (display-only)
  → scoreTicker passes events: [] into metrics (news_tone gated)
```

Daily refresh records **NO_SOURCE** for live events; **does not delete** fixtures.

### General news

No production news store. Daily refresh records **NO_SOURCE**. Absence ≠ neutral tone.

### Scores

```text
After useful prices/fundamentals refresh
  → rescoreListedMarket() (existing methodology)
  → market_scan_* + score_runs
```

---

## 3. Supported sources (18B)

| Dataset | Source | Status |
|---------|--------|--------|
| Prices | Yahoo Finance daily bars | **Implemented** (reuse) |
| Fundamentals | Yahoo annual timeseries | **Implemented** (reuse; unchanged detection improved) |
| Events | None in production daily path | **NO_SOURCE** (fixtures preserved) |
| News | None | **NO_SOURCE** |

---

## 4. Sources rejected / deferred

| Source | Why |
|--------|-----|
| Bursa public announcements scrape | Cloudflare 403; Phase 18 |
| Bursa paid packages | Out of scope for 18B (no licensing) |
| KLSE Screener live crawl | ToS / Crawl-delay; not production-ready |
| Apify | Same mirror risk; paid convenience only |
| iSaham | No announcements/news endpoints |
| Company IR as primary | Not scalable to ~1,058 names |

---

## 5. Daily refresh architecture

```text
npm run refresh:daily
        ↓
Universe = listed instruments in SQLite
        ↓
Prices (Yahoo, range=1mo)     ─┐
Fundamentals (Yahoo)          ─┼─ independent; partial OK
Events → NO_SOURCE            ─┤
News → NO_SOURCE              ─┘
        ↓
Persist refresh_runs rows
        ↓
Rescore listed market (methodology unchanged)
        ↓
Print human + JSON summary
```

Overall status derives primarily from **prices + fundamentals**.

---

## 6. Dataset frequencies

| Dataset | Cadence | Notes |
|---------|---------|-------|
| Prices | Daily after ~18:00 MYT | EOD bars; 1mo window upsert keeps history |
| Fundamentals | Daily check | Only persists inserts/fills; else UNCHANGED |
| Events | Unresolved live | Manual `events:ingest` fixture only |
| News | Unresolved | — |
| Scores | After price/fund refresh | Rescore snapshot |

---

## 7. Failure handling / no-source fallback

Statuses: `SUCCESS | PARTIAL | NO_SOURCE | SOURCE_FAILED | NO_DATA | UNCHANGED`.

- Failed Yahoo ticker → prior `price_bars` / `financial_periods` **unchanged**.
- `NO_SOURCE` events/news → prior `events` **unchanged**.
- `last_successful_at` advances only on SUCCESS / PARTIAL / UNCHANGED / NO_DATA.
- Freshness/confidence continue to age via existing rules — **no artificial score penalty**.

---

## 8. Provenance (`refresh_runs`)

Per dataset/provider attempt: `run_id`, `dataset`, `source`, `status`, timestamps, `market_date`, counts, `last_successful_at`, `error_summary`, optional `metadata_json`.

Coexists with existing `ingest_reports` (detailed ingest payloads).

---

## 9. Timezone / market close

- Market date: `Asia/Kuala_Lumpur` calendar date.
- Existing `scripts/prices-daily.sh` local daemon targets **18:00 MYT** (`Asia/Kuala_Lumpur`) with min 12h spacing and invokes **`npm run refresh:daily`** (no duplicated ingest). Not a Vercel Cron.
- Weekends/holidays: Yahoo simply returns last available session; no holiday calendar required for v1.

---

## 10. Scheduling recommendation

| Option | Fit |
|--------|-----|
| **Local / self-hosted cron or `prices-daily.sh`** | **Recommended now** — writable SQLite; script calls `refresh:daily` |
| GitHub Actions | Good later if secrets + artifact/DB sync designed |
| **Vercel Cron** | **Not suitable** — snapshot is **read-only**; writes refused |

Do **not** enable production cron on Vercel until a writable worker + snapshot pack step exists.

---

## 11. Manual command

```bash
npm run refresh:daily
npm run refresh:daily -- --skip-rescore   # ingest provenance only
```

Requires writable local DB (`BURSA_SQLITE_PATH` or `data/sqlite/research.db`). Refuses under `VERCEL` / `BURSA_SNAPSHOT_READONLY`.

---

## 12. Future scheduler plan

1. Validate several local `refresh:daily` runs on full universe.  
2. Run `npm run ingest:prices:daily` (local daemon) or systemd/cron wrapping the same command after 18:00 MYT.  
3. Optionally `npm run snapshot:pack` + commit/deploy for Vercel read model.  
4. Only after ToS/QA: evaluate KLSE/events provider behind a flag.

---

## 13. Implemented / investigated / recommended / unresolved

| Item | State |
|------|-------|
| Architecture map | Implemented (this doc) |
| Yahoo daily prices in orchestrator | Implemented |
| Yahoo fundamentals + unchanged counts | Implemented |
| `refresh_runs` provenance | Implemented |
| `npm run refresh:daily` | Implemented |
| Events/news live providers | Unresolved → NO_SOURCE |
| Vercel cron | Rejected for writes |
| Local post-close schedule | Recommended |
| KLSE production scrape | Unresolved / not enabled |
| Score methodology changes | Not done (invariant) |

---

## 14. Known gaps

- Full-universe Yahoo run is slow (~200ms/ticker → tens of minutes).  
- No holiday calendar.  
- Vercel demo stays stale until a snapshot is re-packed after a local refresh.  
- Structured announcements still fixture/display-only.  
- No general news store.
