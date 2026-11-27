# Set up price watches

On a stock page, save a price watch for either a target in RM per share or entry into the Genesis fair range. Open **Alerts → Price watches** to see what has triggered and how far the other stocks are from their targets or ranges. This is for research, not a buy or sell instruction.

- A target shows as triggered while the latest saved close is at or below it.
- A fair-range watch triggers when a new saved close is inside the current displayed range (including its endpoints) and the preceding saved close was outside that range. A price already inside when you set the watch does not trigger it. The saved closing date is shown on each card; a stock without an eligible close or range stays on the list.
- Alerts are checked when you open the page from the latest published data. The watches stay saved until removed. These are on-page alerts, not live quotes, push notifications, or a history of past triggers.

## Vercel setup (project owner)

1. In the Vercel Marketplace, add an **Upstash Redis** database and connect it to the Genesis Vercel project’s **Production** environment. Use a separate database if you also enable watches for Preview.
2. Under **Settings → Environment Variables**, verify the project has both **`KV_REST_API_URL`** and **`KV_REST_API_TOKEN`** (the read/write token). If configuring from the Upstash dashboard instead, you can use **`UPSTASH_REDIS_REST_URL`** and **`UPSTASH_REDIS_REST_TOKEN`**. Keep these server-only; do not add a `NEXT_PUBLIC_` prefix. The complete `KV_REST_API_*` pair takes precedence if both pairs are set.
3. Deploy again so the production deployment receives the variables. Keep the existing site password configured. Every device signed in with that password sees the same watches; there are no individual accounts.

No new refresh job or change to the research snapshot is needed. Without Redis credentials, production shows that price watches aren't set up. In local development without Redis credentials, the app saves watches in the separate, ignored `data/sqlite/price-watches.db` file, including when using the read-only research snapshot.

## Holdings and starred stocks

These use the same Redis connection as price watches. If price watches already use Redis, there are no new settings or environment variables. Otherwise, follow the Redis setup above to enable sync; without it, holdings and stars stay in the current browser. A temporary server outage shows an error instead of saving to a separate browser list.

After sync is enabled, open Genesis in each browser that has saved holdings or stars. Genesis imports them once, keeping the server version of any ticker already saved or removed. If the combined lists exceed 1,000 holdings or 500 stars, the browser originals are kept and the synced portfolio is still usable. Use **My holdings → Backup** to keep a copy of your holdings. **Restore** replaces holdings only, not stars, and asks for confirmation. Every device signed in with the shared password sees the same portfolio.

**My holdings** and **Alerts** flag changes to the displayed research score or fair range for stocks you own, comparing the two latest comparable published runs when both have values. They also flag saved price watches that have triggered. These are research notes, not buy or sell instructions.
