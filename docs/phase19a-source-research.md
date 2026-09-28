# Phase 19A — Live News & Event Source Research

**Status:** Research only. No provider, schema, scoring, or `NO_SOURCE` change.  
**Research date:** 28 September 2026.  
**Checkpoint:** `3f7fd2cb8934bdba578f43b8c15ee37b479debb3` on `main` (Phase 18 provenance fix).  
**Universe scale:** about 1,058 listed instruments.  
**Daily refresh today:** Events = `NO_SOURCE`. News = `NO_SOURCE`.

---

## 1. Phase 19A — Source Research

### Purpose

Identify whether any realistic, lawful, and affordable source can supply Malaysian listed-company events and news for unattended ingestion, while preserving:

- a source-provided publication time (`published_at`), never replaced by retrieval time
- `retrieved_at` as the ingest clock only
- source provenance and source reliability
- Bursa ticker / company mapping that the source itself states
- event type, and room for later sentiment, materiality, and confidence
- stable identifiers for deduplication

This document records the 28 September 2026 findings. It does not implement a provider.

### What Genesis needs from an event source

All of the following, at once:

1. Coverage across roughly 1,058 Bursa listings, not a handful of large names.
2. Unattended access that the source’s terms allow.
3. A ticker, Bursa code, or legal name the source itself ties to the item.
4. A publication date or datetime supplied by the source.
5. Reliability high enough to treat the row as a company event rather than commentary.

Missing any one of these is enough to reject the source as Genesis’s primary event feed.

### Overall conclusion

No free source identified on 28 September 2026 meets all five requirements. The official Bursa announcement register is the right kind of primary record, and it is viewable in a browser, but plain HTTP is blocked. KLSE Screener returned structured announcement HTML, and its terms forbid robots and scraping. iSaham’s published API does not include announcements or news. Issuer sites and Malaysian news outlets do not substitute for a universe filing register.

**Do not implement a live event or news provider on this evidence.** Keep Events and News as `NO_SOURCE`.

---

## 2. Executive conclusion

There is currently no free source identified that Genesis can lawfully and reliably use for unattended company-event ingestion across the Bursa universe.

These are separate tests. A source can pass one and fail the others:

| Test | Meaning |
|------|---------|
| Viewable in a browser | A person can open the page. Search and browser fetches of Bursa’s announcement list showed a date / company / title table. |
| Technically accessible | An unattended HTTP client receives the document. Bursa and `disclosure.bursamalaysia.com` failed this test (Cloudflare `403`). KLSE Screener HTML passed it. |
| Allowed for unattended automation | Terms or a licence permit a robot to copy the data. KLSE Screener’s terms do not. No public Bursa announcements API was identified. |
| Reliable enough for the event dataset | The row is a filing (or an issuer’s own notice), with a source date and a stated ticker or code. Secondary journalism does not meet this bar. |

“Publicly viewable” is not “practically ingestible,” and “HTTP 200” is not permission to automate.

---

## 3. Sources investigated

### Bursa Malaysia company announcements

**Role:** Primary. This is the conceptual foundation of a future event dataset.

**What was seen**

- Public list: `https://www.bursamalaysia.com/market_information/announcements/company_announcement`
- A search/browser-style fetch of that URL showed announcement date, company name, and title, including rows dated 3 September 2026.
- Direct curl of the same URL, and of `https://www.bursamalaysia.com/robots.txt`, returned **HTTP 403**, Cloudflare, `cf-mitigated: challenge`, page title “Just a moment…”.
- Bursa’s published API Gateway (media release dated 24 May 2024, and the API Services page) is for **CDS account onboarding by brokers**, not company announcements.
- The website FAQ describes following a company in the browser. No announcements RSS or JSON API was identified.

**Timestamps**

The browser render shows a calendar date. Clock precision and timezone on the official page are **UNVERIFIED**, because unattended HTTP could not read the HTML.

**Why it is not an ingestion path today**

It remains the preferred primary source. It is not an unattended path while Cloudflare blocks plain HTTP and no public announcements API has been identified. Licensed historical packages were not re-read on 28 September 2026 (that catalogue URL was also HTTP 403). Older notes of package prices are **UNVERIFIED** until the current catalogue can be read.

### Bursa disclosure host

**Role:** Primary filing host linked from KLSE detail pages.

**What was seen**

- `https://disclosure.bursamalaysia.com/` returned **HTTP 403** with the same Cloudflare challenge.
- `https://announcements.bursamalaysia.com/` did not resolve (DNS failure). KLSE pages also link to `https://announcements.bursamalaysia.com/EDMS`.
- No open announcements API was identified on this host.

Field-level contents, timestamps, and ticker fields are **UNVERIFIED**.

### KLSE Screener

**Role:** Third-party HTML mirror of Bursa filings. Research evidence only.

**Do not scrape KLSE Screener.** The pages are useful for understanding which fields a real filing carries. They are not an approved Genesis ingestion source.

**What was seen on 28 September 2026**

| Check | Result |
|-------|--------|
| `https://www.klsescreener.com/robots.txt` | HTTP 200. `User-agent: *` and `Crawl-delay: 20` |
| `https://www.klsescreener.com/v2/announcements` | HTTP 200, about 206 KB. 30 detail links. Clocks such as `11:22 am` |
| `https://www.klsescreener.com/v2/announcements.json` | HTTP 500. `An Internal Error Has Occurred.` |
| `https://www.klsescreener.com/v2/announcements/view/11674089` | HTTP 200 |

That detail page included:

- Ticker **HLCAP**, stock link `/v2/stocks/view/5274`
- Legal name **HONG LEONG CAPITAL BERHAD** on the list beside the row
- **Date Announced:** `28 Sep 2026` (date only)
- **Category:** `Document Submission`
- **Reference Number:** `DCS-30092025-00020`
- Bursa URL containing `ann_id=3709274`

The reference string contains `30092025`. That must not be parsed as `published_at`. The page’s own date is 28 September 2026. The list clock and the detail date are different precisions. No timezone label was in the HTML.

**Terms**

`https://www.klsescreener.com/v2/pages/terms` returned HTTP 200. Without prior written consent, the terms forbid using a robot, spider, crawler, or scraper to monitor or copy the app, and scraping content for use elsewhere. Data is described as free for reference. That is browsing, not an integration licence.

Written consent from KLSE Screener is **UNVERIFIED** (not requested in this research).

### iSaham

**Role:** Market-data REST API. Not an event source on the published docs.

`https://api.isaham.my/docs` returned HTTP 200. Documented `/v1/` routes are quote, profile, fundamentals, chart, technical, reports, list, market overview, IPO upcoming, IPO live, search, account usage, and system IP. Authentication is a bearer token. The docs describe v1 as beta, with credit and tier limits.

No announcements or news route was identified. A symbol such as `MAYBANK` or a numeric code such as `1155` applies to those market routes only. Ringgit prices for API tiers were **UNVERIFIED** in the docs extract. The consumer page `https://www.isaham.my/pricing` is courses and screeners, not the API price card.

### Issuer IR / listedcompany.com

**Role:** Primary for that one issuer. Not a universe provider.

- `https://bursa.listedcompany.com/newsroom.html` is Bursa Malaysia Berhad’s own investor site, not the exchange-wide announcement register. A search fetch showed issuer notices with dates such as 20 May 2026.
- Curl of that URL and of `https://maybank.listedcompany.com/news.html` returned **HTTP 202 and an empty body**.
- `cimb.listedcompany.com` did not resolve.
- Two guessed Maybank RSS paths timed out with no body.

An issuer page can carry a source-provided date and is high quality for that company when a person can read it. About 1,058 separate sites means 1,058 layouts, dead links, and no shared identifier. A universe IR crawler should not be built. Whether unattended IR fetching is permitted or reliable at scale is **UNVERIFIED**.

### Bernama

**Role:** Secondary journalism. Not a filing register.

- `https://rss.bernama.com/` returned HTTP 200. The static HTML is a landing page. The only feed-like href was the template `${link}`.
- `https://rss.bernama.com/business.xml` and `https://www.bernama.com/en/rss/business.php` returned HTTP 404.
- A Bernama search for “bursa malaysia bhd” returned dated market stories (for example 24 February). Those are articles, not the announcement register.

Story pages can carry a dateline. That is a journalistic publication time, not a filing timestamp. Real RSS URLs, if any exist behind the landing page, are **UNVERIFIED**. Mapping is by company name in the headline. That is not safe to automate.

### The Edge Malaysia

**Role:** Secondary financial journalism. Not a filing register.

- `https://theedgemalaysia.com/node/817994` is a real article. It says it first appeared in Capital for **14–20 September 2026** and discusses several companies.
- `https://theedgemalaysia.com/rss.xml` and `https://theedgemalaysia.com/feed` returned HTTP 404.

Coverage is selected names and commentary, not every listed company. Paywall depth and any undocumented feed are **UNVERIFIED**. A weekly issue window is not a precise `published_at`. Several companies in one story must not be split into filings by name matching.

### Yahoo Finance

**Role:** Checked as a possible news query. Not treated as a Genesis event source.

`https://query1.finance.yahoo.com/v1/finance/search?q=MAYBANK.KL&newsCount=5` returned HTTP 200 and `"news": []`. The query was reachable. It returned no usable MAYBANK.KL news items, so there were no publication timestamps to store.

### Checked and not carried as candidates

| URL | Result on 28 September 2026 |
|-----|------------------------------|
| `https://www.malaymail.com/feed` | Cloudflare HTTP 403 |
| `https://www.thestar.com.my/rss` and `https://www.thestar.com.my/rss/business` | HTTP 404 |

Community KLSE scrapers and paid Apify actors that copy KLSE Screener were not treated as a permitted source. They automate a site whose terms forbid that copying.

---

## 4. Source comparison

No numerical scores. `UNVERIFIED` means this research did not confirm the cell.

| Source | Coverage | Primary/Secondary | Automation | Timestamp quality | Ticker mapping | Cost/access | Genesis suitability |
|--------|----------|-------------------|------------|-------------------|----------------|-------------|---------------------|
| Bursa company announcements | Universe in a browser render; bulk history **UNVERIFIED** (catalogue page blocked) | Primary | Browser only. Curl HTTP 403. No public announcements API identified | Calendar date in the browser render. Clock and timezone **UNVERIFIED** | Company name on the list. Ticker field in the blocked HTML **UNVERIFIED** | Free to view. Licensed packages are paid; current price **UNVERIFIED** | Preferred primary record. Not an unattended path today |
| disclosure.bursamalaysia.com | Intended filing host. Contents **UNVERIFIED** | Primary | Curl HTTP 403 | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | Not an unattended path |
| KLSE Screener HTML | Live list (30 rows on the page fetched). Full archive depth **UNVERIFIED** | Aggregator of primary filings | HTML HTTP 200. JSON HTTP 500. Terms forbid robots and scraping without written consent | List clock (for example `11:22 am`) with no timezone label. Detail date only (`28 Sep 2026`) | Stated on the sample: symbol, Bursa code, legal name | Free to browse. Not a licence to automate | Research evidence only. Do not scrape |
| iSaham API | Market data for Bursa symbols on the documented routes. Not filings | Aggregator of market data | REST with a bearer token | Not an events feed | Symbol or numeric code on quote-style routes | Free tier plus paid credits. Ringgit prices **UNVERIFIED** | Not an event source |
| Issuer IR / listedcompany.com | One issuer at a time | Primary for that issuer only | Curl of two newsroom URLs returned HTTP 202 and an empty body. Scale **UNVERIFIED** | Often a calendar date when a person can read the page. Datetime **UNVERIFIED** | The site is already that company | Free where a page actually loads | Manual check for a few names. Not a universe crawler |
| Bernama | Market stories, not the filing register | Secondary | Landing page HTTP 200. Guessed XML paths HTTP 404. Real feed URLs **UNVERIFIED** | Story datelines. Feed timestamps **UNVERIFIED** | Company name in headlines. No reliable ticker | Free to read | Do not substitute for filings |
| The Edge Malaysia | Selected companies and commentary | Secondary | `/rss.xml` and `/feed` HTTP 404. Other feeds **UNVERIFIED** | One article used a weekly issue window, not a precise timestamp | Several companies in one story | Free articles exist. Paywall **UNVERIFIED** | Do not substitute for filings |
| Yahoo Finance search news | Tested query only (`MAYBANK.KL`) | Secondary if items existed | Search URL HTTP 200 | None on this query (`news: []`) | Not exercised | Free query, no items | Not a viable event source on this test |

---

## 5. Data-quality requirements discovered

### Timestamps

- `published_at` must come from the source (announcement date or a real datetime the source prints).
- `retrieved_at` is when Genesis fetched the row. It is not publication time.
- Do not store today’s date as the publication time.
- Do not derive publication time from a reference number. On the KLSE sample, `DCS-30092025-00020` does not match **Date Announced** `28 Sep 2026`.
- If only a date is known, store that date and leave the clock unknown. Do not invent midnight or a session close.

### Ticker and company mapping

- Prefer a relationship the source states: ticker symbol, Bursa numeric code, and legal name on the same item (as on the KLSE sample).
- Do not fuzzy-match a company name into `instrument_id` for primary events.
- Do not assign a ticker because a news article mentions a company, a subsidiary, or an old name.
- A story that names several companies is not several filings.

### Deduplication

Identifiers observed on the KLSE sample, as evidence of what a filing can carry:

- Bursa `ann_id` (sample `3709274`)
- Reference number (sample `DCS-30092025-00020`)
- KLSE view id (sample `11674089`)

The same filing can appear as a KLSE page and a Bursa `ann_id`. Listing those ids does **not** approve KLSE as a production source. News articles from Bernama or The Edge were not shown to share these ids.

### Reliability versus interpretation

Keep these separate:

| Concept | Meaning |
|---------|---------|
| Source reliability | How close the row is to a primary filing. A Bursa notice is not the same thing as a magazine article or a third-party mirror. |
| Mapping confidence | Whether the source stated the ticker or code, or whether a human still has to guess. |
| Event confidence | How sure Genesis is about the event type and the row as a whole. |
| Sentiment | Genesis’s reading (`POSITIVE`, `NEGATIVE`, `NEUTRAL`, `UNCERTAIN`, `UNKNOWN`). Not a field these sources were shown to provide. |
| Materiality | Genesis’s reading of importance. Not a field these sources were shown to provide. |

A category such as “Document Submission” or “Financial Results” can later inform `event_type`. It is not sentiment. A KLSE mirror should not be labeled as reliable as Bursa itself. Absence of news is not a neutral tone.

---

## 6. Recommended architecture

### Primary filings

If Genesis later obtains a **permitted or licensed** primary feed:

```text
Primary filings
  → source id (Bursa ann_id) and/or reference number
  → source-provided date (not retrieved_at)
  → ticker or code the source states
  → deduplication
  → events
```

Those rows are the event dataset. Source reliability for a real Bursa filing is the high end. Sentiment and materiality stay Genesis interpretations, stored separately from the fact that the filing exists.

### Secondary news

Journalism (Bernama, The Edge, and similar) stays outside the filing register.

- Do not merge an article into the official event just because it mentions the same company.
- Do not let secondary news change Research Score or Valuation Score.
- Phase 18 already keeps news out of scoring. This research does not change that.

### Until a permitted source exists

Keep:

- Events = `NO_SOURCE`
- News = `NO_SOURCE`

Do not insert placeholder rows. Do not invent a neutral event or a neutral news tone so the dashboard looks populated.

IR pages remain a manual check for a small watchlist, not a second crawler.

---

## 7. Explicitly rejected approaches

Phase 19A does **not** recommend:

| Approach | Why it was rejected |
|----------|---------------------|
| Bypassing Bursa Cloudflare | The public register is blocked to plain HTTP (`403`, `cf-mitigated: challenge`). Evading that control is not an ingestion design. |
| Scraping KLSE Screener | HTML is reachable and informative, and the terms forbid robots, spiders, crawlers, and scraping without written consent. |
| Browser automation to evade access controls | Same problem as the Cloudflare block: viewable in a browser is not permission to automate. |
| About 1,058 issuer IR crawlers | Layouts differ, links die, and curl already saw HTTP 202 with an empty body. There is no shared id. |
| Using iSaham as the event source | The published `/v1/` docs have market-data routes and no announcements or news route. |
| Treating Bernama or The Edge as the filing register | They are secondary articles. Feeds checked here did not work. Mapping by company name is unsafe. |
| Fuzzy company or ticker matching for primary events | Subsidiaries, old names, and multi-company stories will attach filings to the wrong `instrument_id`. |
| Using `retrieved_at` as `published_at` | Retrieval time is not when the company announced the item. |
| Changing `NO_SOURCE` so the product looks populated | That would store the absence of a source as if it were data. |

---

## 8. Unknowns / items requiring future verification

Left unresolved on purpose:

- Official Bursa announcement clock precision and timezone.
- Current Bursa information-package prices, and whether a package includes full announcement text. The catalogue URL returned HTTP 403 on 28 September 2026.
- Whether written permission could make a mirror or access path allowed. Not requested in this research.
- Exact timestamp behaviour of any future permitted source.
- Bernama RSS URLs beyond the landing page (`${link}` in static HTML; guessed XML paths returned 404).
- The Edge paywall and any feed other than the two paths that returned 404.
- iSaham API prices in ringgit.
- Whether issuer IR automation is permitted or reliable at scale. Two `listedcompany.com` newsroom URLs returned HTTP 202 and an empty body to curl.
- How often a KLSE list clock and a detail “Date Announced” disagree, beyond the one page inspected.
- PN17 / GN3 row shape on the official site. Not extracted, because curl could not read the official HTML.

Do not fill these gaps by assumption.

---

## 9. Phase 19B recommendation

**Do not implement a live provider in Phase 19B on this evidence.**

A reasonable next step is a **source-ready design pass** only. That pass can write down, still without a live fetch:

- how a permitted filing would map onto existing event fields
- primary filings versus secondary news
- deduplication when both an `ann_id` and a reference number exist
- date-only `published_at` versus unknown time
- ticker mapping only when the source states the code
- how to hold or reject an ambiguous multi-company item
- tests that `retrieved_at` is never copied into `published_at`

This document does not implement that design, and it does not change schema, scoring, refresh, or `NO_SOURCE`.

---

## 10. Evidence / URLs

Checked **28 September 2026** unless a page’s own date is noted.

| Claim | URL | Result |
|-------|-----|--------|
| Bursa robots and announcements blocked | `https://www.bursamalaysia.com/robots.txt` and `https://www.bursamalaysia.com/market_information/announcements/company_announcement` | HTTP 403, `cf-mitigated: challenge` |
| Browser-style fetch still showed an announcement table | Same company-announcements URL via search fetch | Rows dated 3 September 2026. This is not the curl result |
| Historical-package page blocked | `https://www.bursamalaysia.com/market_information/market_data/historical_data_packages` | HTTP 403, challenge. Current prices **UNVERIFIED** |
| Bursa API Gateway is CDS onboarding | `https://www.bursamalaysia.com/cn/about_bursa/media_centre/bursa-malaysia-introduces-api-gateway-for-enhanced-investors-onboarding-experience` (release dated 24 May 2024) and `https://www.bursamalaysia.com/trade/our_products_services/central_depository_system/bursa_malaysia_depository_services/api_services` | Not an announcements API |
| Disclosure host blocked | `https://disclosure.bursamalaysia.com/` | HTTP 403, challenge |
| Announcements host did not resolve | `https://announcements.bursamalaysia.com/` | DNS failure |
| KLSE robots | `https://www.klsescreener.com/robots.txt` | HTTP 200, `Crawl-delay: 20` |
| KLSE list and JSON | `https://www.klsescreener.com/v2/announcements` and `https://www.klsescreener.com/v2/announcements.json` | HTML 200; JSON 500 |
| KLSE detail fields | `https://www.klsescreener.com/v2/announcements/view/11674089` | HTTP 200. Date `28 Sep 2026`. `ann_id=3709274`. HLCAP / 5274 |
| KLSE terms forbid scraping | `https://www.klsescreener.com/v2/pages/terms` | HTTP 200 |
| iSaham docs | `https://api.isaham.my/docs` | HTTP 200. No announcements route identified |
| iSaham consumer pricing page | `https://www.isaham.my/pricing` | Courses and screeners, not the API price list |
| Bernama RSS landing page and missing XML | `https://rss.bernama.com/` and `https://rss.bernama.com/business.xml` | Landing page 200; XML 404 |
| The Edge article and missing feeds | `https://theedgemalaysia.com/node/817994`, `https://theedgemalaysia.com/rss.xml`, `https://theedgemalaysia.com/feed` | Article loads (issue window 14–20 September 2026). Feeds 404 |
| Yahoo news query empty | `https://query1.finance.yahoo.com/v1/finance/search?q=MAYBANK.KL&newsCount=5` | HTTP 200, `news: []` |
| Malay Mail and Star feeds | `https://www.malaymail.com/feed`, `https://www.thestar.com.my/rss`, `https://www.thestar.com.my/rss/business` | Malay Mail 403; Star 404 |
| listedcompany.com curl | `https://maybank.listedcompany.com/news.html`, `https://bursa.listedcompany.com/newsroom.html` | HTTP 202, empty body |
