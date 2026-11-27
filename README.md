# Genesis Research

[Genesis Research](https://genesisresearch.vercel.app/) is a personal research dashboard for Bursa Malaysia stocks and REITs. Use it to shortlist companies and assess entry prices. **Research only, not a buy or sell instruction.**

- **Research score:** compares financial and price measures with other companies using percentile ranks. Ordinary companies, banks, REITs and other financial firms are assessed using measures that fit their business. Banks are compared with other banks on their equity cushion and weakest annual return on assets over three years, not industrial debt ratios. Missing inputs are not filled in. A stored PN17 flag deducts 20 points; negative annual free cash flow deducts 5 where that measure applies (not for banks or REITs). The score cannot fall below zero, and eligibility checks are separate. The stock page explains any deduction after the next successful refresh and publication.
- **Buy score:** ranks a company's research score against other scored stocks, with a cap when safety or data checks fail. It isn't an instruction to buy today.
- **Fair-value range:** a separate estimate for judging whether the last saved price is below, inside or above the range. It does not change the Buy score and may be unavailable if the evidence is too thin.

The site also has a market scan, alerts, a calendar and a track record for past top picks. Holdings and starred stocks are saved in your current browser, not synced across devices.

You can [record or import analyst 12-month targets](docs/analyst-targets.md) from a stock page and compare them with the Genesis fair range.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
BURSA_SNAPSHOT_READONLY=1 npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147/). This runs against a read-only copy of the published data. The dev command downloads the snapshot if it's missing; run `npm run snapshot:fetch` to verify or update an existing copy.

Without `BURSA_SNAPSHOT_READONLY=1`, the app uses a separate, writable SQLite database at `data/sqlite/research.db`. It does not populate that database from the published snapshot. For a local password, copy [`.env.example`](.env.example) to `.env.local` and set `SITE_PASSWORD`. With no password set, local development leaves the gate off; production stays locked.

## Data and refresh

Prices are saved **end-of-day closes**, not live quotes. Yahoo Finance supplies closes and available financial figures; CSV imports are also supported. **Data as of** is the latest saved price date, not a guarantee that all stocks have prices from that date.

Dividend yield uses Yahoo cash dividend events from the 365 days before the saved close, by **ex-dividend date**, not cash payment date. Where the event history doesn't cover the full window, Genesis uses reported full-year dividends if available. The first refresh after this update backfills the history using the same Yahoo price requests.

After signing in, use **Refresh data** to request an on-demand run. The same [Refresh data workflow](.github/workflows/refresh-data.yml) attempts a refresh on weekdays at 6:23, 8:23 and 11:23 pm Malaysia time. Scheduled checks skip refresh if that day's after-close snapshot has already been published. GitHub can delay scheduled runs. When the bar says **Done**, reload to see the new data.

The workflow validates and packs a read-only SQLite snapshot. Main tracks [a pointer](data/snapshot.json) to the exact data commit, not the database itself. The `data-snapshot` branch holds the latest copy and `data-snapshot-previous` holds the previous published copy. The production build downloads the pinned snapshot and checks its size and checksum; Vercel opens it in memory for read-only queries. If the download or verification fails, the build fails rather than publishing an incomplete site.

Production uses a shared `SITE_PASSWORD`; the on-demand refresh also uses a server-only `GITHUB_REFRESH_TOKEN`. See the [password and refresh setup guide](docs/refresh-setup.md) for configuration and troubleshooting. Never commit passwords, tokens or the local database.

## Pull request checks

[GitHub Actions](.github/workflows/pr-checks.yml) runs the following on every pull request targeting `main`. The checks need no new secrets or Vercel settings and do not refresh or publish data.

```sh
npm ci
npm test
npm run lint
npm run build
```

Run the same commands locally before opening a pull request. The build needs network access to fetch the public snapshot if a verified local copy is not already present.
