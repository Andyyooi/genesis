# Set up the shared password and Refresh data

The website never downloads prices or writes its research database. **Refresh data** asks GitHub Actions to refresh a writable copy, validate it, commit only the gzip snapshot to `main`, and push. Vercel's existing Git integration deploys that commit. There is no schedule and no Vercel integration setting to change.

The older per-company/watchlist “Refresh & Research” website controls are retired, including their local-execution API endpoints (HTTP 410). Local maintenance CLIs remain available; the new website button never falls back to executing them on the web server.

## 1. Merge the code first

Merge this work into `main`, including `.github/workflows/refresh-data.yml`. GitHub must know about the workflow on the default branch before it can be dispatched. The job always checks out and publishes to `main`, even if you select another dispatch ref.

## 2. Create Andy's GitHub token

In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

- Give it a clear name, such as `Genesis Vercel refresh`.
- Set the resource owner to **Andyyooi**, and repository access to **Only select repositories → genesis**.
- Under repository permissions, set **Actions: Read and write**. **Metadata: Read-only** is included automatically. No Contents write permission is needed for this PAT: it triggers and reads Actions, but does not push commits.
- Set an explicit expiry, for example **90 days**, and a reminder to replace the token in Vercel before it expires. If an organization approval is requested, complete that approval first.
- Copy it directly into Vercel. Never put it in source code, a `NEXT_PUBLIC_` variable, a screenshot or a commit.

Anyone with the shared site password can trigger the job. The API checks for existing queued/running jobs; Actions concurrency also prevents simultaneous refresh work. A simultaneous dispatch from another server instance can still queue a second job: GitHub's check-and-dispatch API is not an atomic lock.

## 3. Configure Vercel Production

In the Genesis project's **Settings → Environment Variables**, add these for **Production**:

| Name | Value |
| --- | --- |
| `SITE_PASSWORD` | A long, unique shared password |
| `SESSION_SECRET` | An independent long random value (for example, generate with `openssl rand -hex 32`) |
| `GITHUB_REFRESH_TOKEN` | The fine-grained token from step 2 |
| `GITHUB_REPO` | Optional; defaults to `Andyyooi/genesis` |
| `GITHUB_REFRESH_REF` | Optional; defaults to `main`; normally leave it as `main` |

**Redeploy Production** after saving the variables. Existing deployments do not pick up environment changes. Without `SITE_PASSWORD`, production fails closed. Without the GitHub token, the bar says “Refresh isn't set up yet” and names the missing variable. Local development may leave the token unset; no local refresh is run by this button.

Sessions last about 30 days. Changing `SITE_PASSWORD` or `SESSION_SECRET` invalidates existing sessions. Share the password through your normal secure channel, not GitHub.

## 4. Allow the workflow to push

The workflow declares `permissions: contents: write` for its short-lived **GITHUB_TOKEN**. In **genesis → Settings → Actions → General → Workflow permissions**, allow **Read and write permissions**, or rely on the workflow-level permission if repository/organization policy permits it. This is separate from the fine-grained PAT.

If `main` is protected or a ruleset requires pull requests, signed commits, or checks before pushes, the Actions bot may be blocked. An administrator must deliberately allow this snapshot-publishing workflow to push under the repository's policy, or agree on a PR-based publication flow instead. The job does not bypass protection or force-push. A rejected/non-fast-forward push fails safely; inspect the log before retrying. It will never overwrite intervening commits.

## 5. Try a refresh

Sign in and press **Refresh data**. It usually takes **10–20 minutes**; the job timeout is 60 minutes. The bar polls about every 15 seconds and links to the Actions run:

**Queued → Downloading prices & accounts → Re-scoring → Publishing → Deploying → Done — reload to see new data.**

The daily refresh downloads stored-universe prices and due fundamentals (including the new fields where Yahoo provides them), and calculates fair value. Its normal fundamentals freshness gate still applies. The workflow then explicitly runs the new universe-wide rescore/publication before packing. Missing fields and unsupported fair values remain unavailable. Any failed/partial prices, fundamentals or fair-value stage, incomplete scoring, failed pack validation, or rejected push prevents publication. News/events have no live source and do not block publication.

After GitHub succeeds, **Deploying** remains until the site serves a snapshot whose publication timestamp is at least the run start. The prominent **Data as of** date is the latest stored price date; it need not change on weekends. The score/publication timestamp distinguishes a new snapshot on an unchanged market date. If deployment fails, the bar may remain Deploying: check Vercel's deployment logs. Once Done appears, reload to replace the page's old data.

On failure, use **View run** and download the **refresh-log** artifact (retained 30 days). A failed token/status request is shown separately rather than pretending the refresh succeeded. Rotating an expired token requires saving it in Vercel and redeploying again.

## Repository size

The existing gzip is about **20 MB**. Each published refresh adds another binary snapshot revision to Git history, roughly **20 MB per refresh** before Git's compression/delta savings (compressed database blobs may delta poorly). Fifty refreshes could add roughly **1 GB**; actual size grows with the database and score history. Clones and Vercel checkouts will become heavier. There is deliberately no schedule. Monitor repository size and refresh frequency; moving snapshots to versioned object storage would be a separate architecture change, not something this workflow silently does.
