# Phase 16 — News & Bursa Event Infrastructure

## Goal

Store normalized company events/announcements for research timelines.
Events do **not** modify Research Score or Absolute Valuation Score in Phase 16.

## Sources investigated

| Source | Result |
|--------|--------|
| Bursa Malaysia company announcements | Cloudflare-challenged; `robots.txt` not readable without JS challenge. No official free announcements API key in this repo. |
| KLSE Screener announcements HTML | Public page exists; `Crawl-delay: 20`. JSON probe `/v2/announcements.json` returned 500. Not enabled as a live scraper in Phase 16. |
| Company IR / newsroom pages | Usable for curated, hand-labelled rows (e.g. Maybank IR, CIMB Newsroom). |
| iSaham / Apify third-party APIs | Require API keys / paid actors — documented, not hardcoded. |
| Existing Phase 8 CSV | Still supported (`npm run ingest:announcements`). |

## Implemented source

**Curated fixture** `data/raw/events-phase16-fixture.json` via `CuratedFixtureEventProvider`.

```bash
npm run events:ingest
```

Optional tickers: `npm run events:ingest -- MAYBANK CIMB`

## Schema additions on `events`

`published_at`, `retrieved_at`, `source_id`, `event_type`, `sentiment`, `materiality`,
`event_confidence`, `mapping_confidence`, `source_reliability`, `company_name_raw`,
`bursa_code_raw`, `dedupe_key`, `updated_at`

## Confidence rubric

- **HIGH** — PRIMARY/CURATED + HIGH mapping + known `published_at`
- **MEDIUM** — firm map + known published date
- **LOW** — mapped but missing publication date, or LOW mapping
- **UNKNOWN** — unmapped / ambiguous

## PIT

- `published_at` / `available_at` known → potentially PIT usable
- unknown publication → not PIT-safe (`requirePitSafe: true` excludes them)
- `retrieved_at` is ingest clock only

## Scoring gate

`scoreTicker` still loads events for the UI but passes **empty** events into metrics so `news_tone` cannot change Research Score until a later phase explicitly enables it.
