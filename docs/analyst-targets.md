# Record analyst targets

On a stock page, look under **Entry check** for **Analyst 12-month targets**. Open **Add a target or import CSV**. For one report, enter the broker, the 12-month price target in RM per share, the date the report was published and a link to its source, then select **Save target**.

The newest reports appear first, with their publication date and age. An analyst target is a broker's estimate, separate from the Genesis fair range. It does not affect scores or entry checks. Research only, not a buy or sell instruction. Genesis stores your source link but never fetches or scrapes it.

## Import a file

Choose a UTF-8 CSV file and select **Import targets**. The file can contain multiple stocks. Example (fictional figures):

```csv
ticker,broker,target,date,source_url
TAANN,"Example Research, Malaysia",5.25,2026-08-27,https://example.com/taann-report
MAYBANK,Example Broker,10.50,2026-08-25,https://example.com/maybank-report
```

- Use the Genesis ticker shown on the stock page, not the Yahoo Finance symbol or Bursa stock code.
- Use a positive price in RM with up to three decimal places, a date in `YYYY-MM-DD` (not in the future), and an HTTP or HTTPS source link.
- Upload up to 200 rows and 128 KB at once. Fix any validation errors and retry the entire file; invalid rows or unknown tickers are rejected before anything is saved.
- A report with the same ticker, broker (ignoring case) and date replaces the old entry. Reports from different dates are kept.

The signed-in form submits the raw CSV to `POST /api/analyst-targets` with `Content-Type: text/csv`. The endpoint requires the site's session cookie and same-origin `Origin` header. For a manual submission, it accepts the same five fields as a JSON object with a string price and `Content-Type: application/json`.

## Server setup

On Vercel, connect an **Upstash Redis** database to this project via Storage / Marketplace, with `KV_REST_API_URL` and `KV_REST_API_TOKEN` set for Production, then redeploy. The alternative names `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. The same database and credentials used by price watches will work; analyst targets use separate keys. If already configured, there is nothing else to set up. Before storage is connected, the stock page explains that analyst targets are not set up.

Keep the token server-only. In local development with no Redis credentials, reports are saved in `data/sqlite/analyst-targets.db`. Refreshing or replacing the read-only research snapshot does not overwrite saved targets.
