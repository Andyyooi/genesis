# Phase 18 — Event/News Source Strategy

**Status:** Investigation only (no live ingestion implemented).  
**Checkpoint:** `ffd2b2e` on `main` (Phase 17 UI + CAGR NaN fix).  
**Universe scale (packed research DB):** 1,058 instruments (1,039 `COMMON_STOCK` + 19 `REIT`).  
**Watchlist YAML today:** ~30 curated names (not the full tape).  
**Production:** https://genesisresearch.vercel.app/  
**Constraint:** Events remain display-only; Research Score / Absolute Valuation Score unchanged.

---

## 1. Objective

Determine the most reliable and sustainable way for Genesis to obtain **real** company events (and, separately, broader news) for ~1,058 Bursa Malaysia equities and REITs — without building a brittle Cloudflare scraper, inventing publication times, or mixing unstructured media into the scoring engine.

This document ends in an architecture recommendation. It does **not** enable live ingestion.

---

## 2. Sources investigated

| ID | Source | Role examined |
|----|--------|----------------|
| A | Bursa Malaysia official company announcements + Information Services | Primary structured corporate announcements |
| B | Company investor-relations / newsroom sites | Fallback / verification |
| C | KLSE Screener announcements (+ related scraper ecosystem) | Aggregator / mirror of Bursa announcements |
| D | Commercial / licensed market-data vendors (Bursa Historical Data Package, Connectivity, ICE redistributors) | Licensed structured data |
| E | iSaham API | Previously considered “API key” path |
| F | Apify KLSE Screener actor | Paid third-party scrape of KLSE Screener |
| G | Yahoo Finance search news (spot check) | Opportunistic media news |

Also revisited: Phase 16 notes in `docs/phase16-events.md` and the existing `EventSourceProvider` / `published_at` / scoring gate design.

---

## 3. Evidence for each source

### A. Bursa Malaysia official announcements

**What exists (public product surface)**

- Public Company Announcements UI:  
  `https://www.bursamalaysia.com/market_information/announcements/company_announcement`
- Per-announcement detail URLs of the form  
  `.../announcement_details?ann_id=<id>` (observed via KLSE Screener’s “View original announcement” link).
- Announcement date is shown in the public UI (browser). Categories include results, dealings, general announcements, etc.
- Commercial Information Services contact published on Bursa pages: `infoservices@bursamalaysia.com`.
- **Historical Data Package** (public catalogue, browser-reachable via search snippets / package page) lists structured products such as:
  - **C3 — PLC Quarterly Results** (monthly; from 01 Jan 2008; listed MYR/USD prices for personal/internal use).
  - **M12 — Summary of Events** (monthly; from 01 Jan 2008; listed MYR 200 per interval / MYR 1,000 yearly subscription in the published table).
  - Terms state data is for personal/internal use; redistribution needs Bursa permission + royalty.

**Programmatic accessibility (direct evidence, Sep 2026 probes)**

| URL | Result |
|-----|--------|
| `https://www.bursamalaysia.com/robots.txt` | **HTTP 403**, Cloudflare `cf-mitigated: challenge`, body “Just a moment…” |
| Company announcements page | **HTTP 403** same Cloudflare challenge |
| Historical data packages path (non-browser curl) | **HTTP 403** Cloudflare challenge |

**Conclusions for A**

- There is **no documented free public announcements JSON API** found in this investigation.
- Browser viewing ≠ suitable automated ingestion: **Cloudflare challenges block unattended HTTP**.
- Primary sustainable path to official data is **licensed Information Services / historical packages**, not DIY scraping of the public site.
- Exact field-level contents of M12 “Summary of Events” (whether full announcement text vs summary codes) were **not** verified from a purchased sample — treat as **inquiry item**, not proven announcement dump.

**PIT**

- Official announcement datetime is the gold standard for `published_at` when obtained from Bursa LINK / licensed feeds.
- Until Genesis holds licensed rows with explicit publication timestamps, do not claim PIT-safe Bursa coverage.

---

### B. Company IR / newsroom

**Evidence**

- Phase 16 already uses curated IR/newsroom URLs in `data/raw/events-phase16-fixture.json` (hand-labelled).
- Spot check (Phase 18): CIMB IR-style URL returned **HTTP 200**; Maybank IR URL **timed out** in this probe (site reliability varies).
- IR pages can carry results, dividends, and material news with publisher dates — but formats differ by issuer.

**Scalability**

- Maintaining **~1,058 distinct IR URLs** as the **primary** architecture is not acceptable (ops burden, dead links, inconsistent schemas).
- Semi-automatic discovery (e.g. from company websites scraped from Bursa profiles) still requires Cloudflare/Bursa access and ongoing link maintenance — not a primary design.

**Role**

- Suitable as **verification / HIGH-confidence enrichment** for a small watchlist, not as the universe backbone.

**PIT**

- Often usable when IR posts an explicit publish datetime; many pages are date-only. Must be stored as published, never confused with `retrieved_at`.

---

### C. KLSE Screener

**Evidence (direct probes)**

| Check | Result |
|-------|--------|
| `https://www.klsescreener.com/robots.txt` | **200**; `User-agent: *` **Crawl-delay: 20** |
| `/v2/announcements` | **200** HTML (~207 KB); live list of announcements |
| `/v2/announcements.json` | **500** JSON `{"message":"An Internal Error Has Occurred."}` — same failure mode as Phase 16 |
| Detail page e.g. `/v2/announcements/view/11672167` | **200**; fields include **Date Announced**, **Category**, **Reference Number**, body text |
| Original source link | Absolute Bursa URL: `http://www.bursamalaysia.com/.../announcement_details?ann_id=3708157` |
| Categories observed | Financial Results, Dividend, Additional Listing, General Announcement, Changes in Director, Material Litigation, … |
| List page times | Clock times present on list (e.g. `7:42 pm`); detail sample showed **date** under “Date Announced” (date precision may vary by item) |

**Third-party scraper ecosystem (secondary evidence)**

- PyPI `klse-screener-py` documents announcement/news helpers with ~2s rate limiting (community scraper, not an official API).
- Apify actor (see F) explicitly states data is sourced from KLSE Screener and mirrors Bursa announcements.

**Programmatic accessibility**

- HTML is reachable without Cloudflare challenge in this probe environment.
- There is **no documented official KLSE Screener API** for Genesis; JSON probe failed.
- `Crawl-delay: 20` implies at-scale polite crawling is slow (see §7).
- Licensing/ToS of KLSE Screener for bulk automated extraction were **not** obtained as a signed agreement in this phase — treat legal/ToS clearance as a **gate** before any production scrape.

**PIT**

- **Date Announced** + optional list-page time can support `published_at` **if** parsed carefully and validated against Bursa detail.
- If only a calendar date is available, PIT precision is **day-level**, not intraday — must be labelled as such.
- KLSE is a **mirror**; ultimate authority remains Bursa. Prefer storing Bursa `ann_id` URL as `source_url` when present.

**Coverage**

- Market-wide feed exists (not per-ticker only) → better fit for ~1,058 names than per-company IR.
- Completeness vs full Bursa LINK history is **not independently audited** here.

---

### D. Other Malaysian / commercial providers

| Provider | Evidence | Fit for Genesis events |
|----------|----------|------------------------|
| Bursa Connectivity / ICE redistributors | Public pages describe **market data** connectivity (prices/order book), contact `infoservices@bursamalaysia.com`. ICE developer portal lists Bursa streaming/historical **prices**, not proven free announcement APIs. | Likely **price data**, not a drop-in free announcement corpus. Inquiry required for corporate actions/announcements products. |
| Bursa Historical Data Package | Published SKUs include **C3 PLC Quarterly Results** and **M12 Summary of Events** with personal/internal-use pricing from 2008. | Promising for **licensed historical structured events** if M12/C3 match Genesis needs — **sample purchase / sales confirmation required**. |
| Bloomberg / LSEG / FactSet (generic) | Industry vendors sell Malaysia coverage; no free public API evaluated. | Possible long-term but cost usually exceeds personal-research budget unless a specific SKU is confirmed. |

No commercial announcement API key was purchased or tested in this phase.

---

### E. iSaham API (Phase 16 revisit)

**Evidence**

- Marketing site `https://api.isaham.my/` documents a versioned REST API (quotes, fundamentals, technicals, IPO, search, market overview).
- Docs HTML lists endpoints under `/v1/...` including:  
  `stocks/quote`, `profile`, `fundamentals`, `list`, `reports`, `technical`, `chart`, `market/overview`, `ipo/*`, `search`, `account/usage`, `system/ip`.
- **No `/v1/.../announcement` or `/news` endpoint** appeared in the documented endpoint list extracted from the docs page.
- Unauthenticated `GET /v1/stocks/list` → **HTTP 401**  
  `{"error":{"code":"UNAUTHORIZED","message":"Your session has ended. Please sign in again."}}`
- Docs note beta / credit pricing; Cloudflare intermittently challenges docs.

**Conclusion**

- iSaham is a **real authenticated market-data API**, but **not currently an announcements/events product** based on documented endpoints.
- “Requires an API key” alone does **not** make it suitable for Genesis Phase 18 events.

---

### F. Apify KLSE Screener actor

**Evidence**

- Public Store listing: modes `roster_snapshot`, `company_deep`, `announcements`.
- Claims announcement fields: title, category, company name, datetime; mirrors Bursa via KLSE Screener.
- Pricing (Store): **from ~USD $0.40 / 1,000 records** (pay-per-event); roster ~1,139 companies described as one efficient pull.
- Actor docs note throttle ~1 req / 2s for detail pages; “No API key required” for the **target site**, but **Apify account / token** is required to run the actor.
- Apify legal docs: users must use actors for legitimate purposes and remain responsible for underlying site terms.

**Conclusion**

- Apify is a **paid orchestration layer over KLSE Screener scraping**, not an official Bursa license.
- Cost may be fine for personal scale, but **ToS/legal and brittle HTML dependency** remain. Prefer evaluating KLSE directly (if cleared) or licensed Bursa data over depending on a third-party actor as the long-term backbone.

---

### G. Yahoo Finance news (spot check)

- `query1.finance.yahoo.com/v1/finance/search?q=MAYBANK.KL&newsCount=5` returned **HTTP 200** with **0 news items** in this probe.
- Not evidence of usable Bursa announcement coverage.

---

## 4. Comparison table

Legend: ● strong / usable · ◐ partial / conditional · ○ weak / unsuitable / unknown

| Criterion | Bursa official (licensed) | Bursa public web | Company IR | KLSE Screener | iSaham API | Apify→KLSE | Yahoo news |
|-----------|---------------------------|------------------|------------|---------------|------------|------------|------------|
| Bursa coverage | ● (if licensed) | ● content, ○ automation | ○ scale | ◐ mirror | ○ no ann. endpoints | ◐ same as KLSE | ○ |
| Company coverage ~1k | ● | ● | ○ | ◐ | N/A | ◐ | ○ |
| Structured events | ● | ● | ◐ | ● categories | ○ | ● | ○ media |
| Broader news | ○ | ○ | ◐ | ◐ `/v2/news` HTML | ○ | ○ | ◐ |
| Historical | ● packages (C3/M12?) | unknown via bot | ◐ | unknown depth | N/A | unknown | ○ |
| Publication timestamps | ● expected | ● in UI | ◐ | ● Date Announced (+ times on list) | N/A | claims datetime | ◐ if any |
| Source URLs | ● | ● | ● | ● + Bursa `ann_id` link | N/A | depends | ◐ |
| Reliability | ● | ○ bot access | ◐ | ◐ third-party | N/A | ◐ | ○ |
| Programmatic access | ● via contract | ○ CF 403 | ◐ HTML | ◐ HTML; JSON 500 | ● auth API (wrong product) | ● paid API | ◐ |
| Rate limits | contract | CF challenge | site-dependent | Crawl-delay 20 | credits | actor throttle | unknown |
| Auth / API | commercial | none usable | none | none official | required | Apify token | none |
| Cost | paid SKUs | “free” but unusable | free + labour | free + ToS risk | credits | ~$0.40/1k | free |
| Licensing clarity | ● terms published | public site + CF | issuer-dependent | **unclear for bulk** | product ToS | Apify + KLSE ToS | Yahoo ToS |
| Ticker mapping | Bursa codes | Bursa codes | name/ticker | stock name + Bursa link | symbols | company fields | symbols |
| Dedup potential | `ann_id` / ref no. | `ann_id` | URL+date | KLSE id + Bursa `ann_id` | N/A | same | weak |
| PIT suitability | ● if timestamps licensed | ● if obtained | ◐ | ◐ day/time dependent | N/A | ◐ | often weak |
| Maintainability | ● vendor | ○ brittle | ○ 1k URLs | ◐ HTML drift | N/A | ◐ actor drift | ○ |

---

## 5. PIT suitability

Genesis rule (Phase 16, unchanged):

- **`published_at` / `available_at`** = when the market could know.  
- **`retrieved_at`** = ingest clock only.  
- Missing publication time → **not PIT-safe**.

| Source | PIT verdict |
|--------|-------------|
| Licensed Bursa / LINK-class feed with announcement datetime | **Suitable** (target) |
| KLSE Screener with Date Announced (+ time when present), validated vs Bursa URL | **Conditionally suitable** at declared precision (often day-level); label precision; do not invent intraday times |
| Company IR with explicit publish datetime | **Conditionally suitable** for those rows |
| iSaham (current docs) | **N/A** (no events product) |
| Yahoo / generic media without reliable publish time | **Unsuitable** for PIT research |
| Fixture / curated | Suitable **only** for labelled demo rows (already documented as CURATED) |

---

## 6. Coverage / scalability assessment

| Approach | Fit for 1,058 names |
|----------|---------------------|
| Per-company IR crawl | **No** as primary |
| Bursa public site scrape | **No** (Cloudflare) |
| KLSE Screener market-wide announcements HTML | **Scale-feasible technically** if ToS allowed; Crawl-delay 20 → ~3 pages/min; daily incremental via first N pages is practical; full historical backfill via HTML alone is slow/fragile |
| Apify announcements mode | **Scale-feasible cost-wise** for personal use; same underlying mirror risk |
| Licensed Bursa package / feed | **Best long-term scale** if product matches |
| iSaham | **Does not cover events** |

Event vs news must stay separate:

- **Structured events** ← Bursa / KLSE mirror / licensed packages → Phase 16 taxonomy.  
- **News** ← media aggregators / IR press → separate store or clearly tagged `SECONDARY` news stream; **not** a scoring feed in Phase 18.

---

## 7. Cost / access assessment (personal research scale)

Assumptions: ~1,058 instruments; personal/internal use; no redistribution product.

| Path | Rough ops / cost |
|------|------------------|
| **Do nothing live** (fixtures only) | $0; incomplete research UX |
| **KLSE HTML incremental** (if ToS cleared): e.g. 20–50 list pages/day | Low $, high maintainability risk; respect Crawl-delay 20 |
| **Apify announcements**: e.g. 5,000 records/day | ~$2/day upper bound at $0.40/1k — usually far less if deduped incremental |
| **Bursa Historical SKUs** (published table) | e.g. M12 yearly ~MYR 1,000; C3 yearly ~MYR 2,000 — **plus** confirmation that fields satisfy Genesis |
| **Enterprise ICE/LSEG** | Typically far above personal budget unless a retail SKU is identified |

Storage: Phase 16 SQLite `events` schema already supports multi-year rows; volume is modest relative to price bars.

---

## 8. Risks / limitations

1. **Cloudflare on Bursa** blocks naive “official scrape” designs.  
2. **KLSE Screener ToS / robots** — Crawl-delay exists; bulk automation may still violate terms even if technically possible.  
3. **Mirror lag / incompleteness** — KLSE is not Bursa LINK.  
4. **Timestamp precision** — date-only rows are not intraday PIT.  
5. **HTML drift** — scrapers and Apify actors break when markup changes.  
6. **Legal redistribution** — Bursa historical packages forbid redistribution without royalty; Genesis is personal research, but Vercel public demo of licensed rows may need care.  
7. **iSaham mismatch** — easy to confuse “has API” with “has announcements.”  
8. **Scoring temptation** — feeding noisy news into Research Score before classification quality is validated would harm trust.

---

## 9. Recommended architecture

Evidence supports a **dual-track, provider-pluggable** design that **extends** Phase 16 rather than replacing it:

```
┌─────────────────────────────────────────────────────────────┐
│ Track 1 — STRUCTURED CORPORATE EVENTS (primary research)    │
│                                                             │
│  Preferred source of truth:                                 │
│    Licensed Bursa Information Services / LINK-class feed    │
│    (+ optional Historical C3 / M12 after sample validation) │
│                                                             │
│  Evaluation-only secondary (gated on ToS + quality audit):  │
│    KLSE Screener market-wide announcements HTML             │
│    (store Bursa ann_id URL; map ticker via Bursa code/name) │
│                                                             │
│  Verification overlay (small set):                          │
│    Company IR URLs for watchlist HIGH-confidence checks     │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
              EventSourceProvider (existing interface)
                            ▼
        Normalize → Map ticker/Bursa code → Dedupe (ann_id / ref)
                            ▼
        Classify (Phase 16 taxonomy) → Validate published_at
                            ▼
              SQLite events (existing schema)
                            ▼
         Research UI (display-only; scoring gate ON)

┌─────────────────────────────────────────────────────────────┐
│ Track 2 — BROADER NEWS (separate, later)                    │
│  Media / aggregator / IR press — distinct reliability,      │
│  never mixed into structured event scoring until validated. │
└─────────────────────────────────────────────────────────────┘
```

**Why this vs “just scrape Bursa”**  
Official site content is right; **automation is blocked**. Licensed access is the maintainable official path.

**Why KLSE is secondary, not primary**  
Technically reachable and already links to Bursa `ann_id`, but it is a **third-party mirror** with ToS/robots constraints and HTML fragility. Useful for a **controlled evaluation corpus**, not as Genesis’s claimed “official feed.”

**Why not iSaham / Apify-first**  
- iSaham: wrong product surface today.  
- Apify: paid convenience over the same KLSE dependency; acceptable as a temporary eval tool, not architecture core.

**Scoring**  
Keep Phase 16 gate: `scoreTicker` continues to pass **empty** events into metrics until a later, explicit phase enables news factors after data QA.

---

## 10. What Phase 18 *implementation* should do next

After this strategy is approved, the **next implementation step** (still short of full live production ingestion) should be:

1. **Licensed-source inquiry packet**  
   Email `infoservices@bursamalaysia.com` asking specifically for:  
   - company announcement / Bursa LINK machine-readable products  
   - whether **M12 Summary of Events** and **C3 PLC Quarterly Results** include announcement-level timestamps, company identifiers, and categories  
   - personal/internal use pricing and redistribution limits for a private research DB / private demo  

2. **Offline evaluation harness (no production cron)**  
   - Implement a **read-only** `EventSourceProvider` prototype behind a feature flag / CLI that can pull a **small sample** (e.g. one day of KLSE announcement list pages) **only after** ToS review checkbox.  
   - Write results to a **sidecar evaluation JSON**, not the live Vercel snapshot by default.  
   - Measure: mapping hit-rate to Genesis instruments, `%` with parseable `published_at`, presence of Bursa `ann_id`, dedupe collisions.  

3. **QA report gate**  
   - Require finite mapping + timestamp metrics before any decision to schedule daily ingest or to turn off the scoring gate.

4. **Keep fixtures** as the production display path until (2)+(3) pass.

---

## 11. What should explicitly NOT be built yet

- Full-universe live scraper of Bursa Malaysia (Cloudflare bypass / challenge solving).  
- Production cron that writes KLSE/Apify rows into the deployed snapshot without ToS + QA.  
- Enabling `news_tone` / events in Research Score.  
- Hardcoding API secrets.  
- Maintaining 1,058 IR URLs as the primary feed.  
- Treating `retrieved_at` as `published_at`.  
- Replacing Phase 16 taxonomy or rewriting the UI for “AI news.”  
- Assuming iSaham announcements exist because other stock endpoints exist.  
- Paying for enterprise terminals before Bursa Information Services options are clarified.

---

## Unresolved questions (need external answers)

1. Exact schema of **M12 Summary of Events** and whether it is announcement-level.  
2. KLSE Screener written permission / ToS for personal automated polling.  
3. Whether Bursa sells a modern **API/file drop** for company announcements suitable for retail/personal research.  
4. Intraday timestamp availability on Bursa detail vs date-only “Date Announced.”  
5. Historical depth available via KLSE HTML vs licensed packages.  
6. Whether public demo hosting of licensed announcement text is allowed under personal/internal terms.

---

## Appendix — Probe log (Phase 18)

| Timestamp context | Probe | Outcome |
|-------------------|-------|---------|
| Sep 2026 agent session | Bursa `robots.txt` / announcements | 403 Cloudflare challenge |
| Sep 2026 | KLSE `robots.txt` | 200, Crawl-delay 20 |
| Sep 2026 | KLSE `/v2/announcements` | 200 HTML |
| Sep 2026 | KLSE `/v2/announcements.json` | 500 |
| Sep 2026 | KLSE detail + Bursa `ann_id` link | 200; Date Announced present |
| Sep 2026 | iSaham `/v1/stocks/list` | 401 unauthorized |
| Sep 2026 | iSaham docs endpoint list | no announcements/news routes |
| Sep 2026 | Yahoo search news MAYBANK.KL | 0 news |
| Snapshot DB | instruments | 1058 (1039 equity + 19 REIT) |

No scraping bypass, no credentials stored, no schema/scoring/UI changes in this phase.
