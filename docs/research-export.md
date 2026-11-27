# Read-only JSON research export

Generate a separate random token (for example, with `openssl rand -hex 32`) and set it as the server-only `EXPORT_API_TOKEN` in Vercel for the deployments that should allow exports. Redeploy so the new value takes effect. For local use, set it in `.env.local`. Don't reuse the site password, add a `NEXT_PUBLIC_` prefix, put the token in a URL, or commit it. Give your assistant the token through its secret store.

With `EXPORT_API_TOKEN` also set in the caller's environment:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${EXPORT_API_TOKEN}" \
  https://genesisresearch.vercel.app/api/export
```

This token works only for this read-only GET request. A browser's signed-in session alone doesn't authorize it. Missing or incorrect credentials return JSON with HTTP 401; if the server token isn't configured or the saved research can't be read, the endpoint returns HTTP 503. The response isn't cached.

The JSON includes:

- `asOfDate`: the newest saved closing date used for Top Picks (not a live quote), and `researchAsOf`: the date or timestamp of the published research run. A date is `null` if it isn't available.
- `topPicks`: up to 15 picks from the default Top Picks selection, highest research score first. Each includes `ticker`, `name`, `lastClose`, `researchScore` out of 100, and `buyRank`, the site's 0–100 percentile rank after safety checks (e.g. 96 reads “Top 4%”). The rank isn't a signal to buy now.
- `fairRange`: the estimated `low` and `high` price in RM, or `null` if there's no usable range. `pricePosition` contains the `price` used for comparison, the `position` (`below`, `inside` or `above`), and `percent`. Below the range, this is the percentage under the low end; above, it is the percentage over the high end. Inside the range, 0 is the low end and 100 is the high end (50 for a single-point range). If the comparison isn't available, `pricePosition` is `null`.
- `holdings`: currently `null` because holdings are saved in the browser, not on the server. This means unavailable, not an empty portfolio.
- `schema` identifies the response format, and `disclaimer` reminds the reader that this is research, not a buy/sell instruction.
