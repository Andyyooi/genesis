# Set up the shared password and Refresh data

The website never downloads prices or writes its research database. **Refresh data** asks GitHub Actions to refresh a writable copy, validate it, publish the gzip on a data-only branch, then push a small snapshot pointer to `main`. Vercel's existing Git integration deploys that pointer commit. Its build downloads and verifies the pinned snapshot before bundling it. There is no schedule and no Vercel integration setting or environment variable to change for snapshot storage.

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

If `main` is protected or a ruleset requires pull requests, signed commits, or checks before pushes, the Actions bot may be blocked. An administrator must deliberately allow this snapshot-publishing workflow to push under the repository's policy, or agree on a PR-based publication flow instead. The job does not bypass protection and **never force-pushes main**. It uses force-with-lease only on `data-snapshot` and `data-snapshot-previous`; rules for those two branches must permit that. A rejected/non-fast-forward main push fails safely; inspect the log before retrying. It will never overwrite intervening main commits.

## 5. Try a refresh

Sign in and press **Refresh data**. It usually takes **10–20 minutes**; the job timeout is 60 minutes. The bar polls about every 15 seconds and links to the Actions run:

**Queued → Downloading prices & accounts → Re-scoring → Publishing → Deploying → Done — reload to see new data.**

The daily refresh downloads stored-universe prices and due fundamentals (including the new fields where Yahoo provides them), and calculates fair value. Its normal fundamentals freshness gate still applies. The workflow then explicitly runs the new universe-wide rescore/publication before packing. Missing fields and unsupported fair values remain unavailable. Failed refresh validation, incomplete scoring, failed pack validation, or a rejected push prevents publication. News/events have no live source and do not block publication.

After GitHub succeeds, **Deploying** remains until the site serves a snapshot whose publication timestamp is at least the run start. The prominent **Data as of** date is the latest stored price date; it need not change on weekends. The score/publication timestamp distinguishes a new snapshot on an unchanged market date. If deployment fails, the bar may remain Deploying: check Vercel's deployment logs. Once Done appears, reload to replace the page's old data.

On failure, use **View run** and download the **refresh-log** artifact (retained 30 days). A failed token/status request is shown separately rather than pretending the refresh succeeded. Rotating an expired token requires saving it in Vercel and redeploying again.

## Repository size

The gzip is currently about **38 MB**. Main now tracks only `data/snapshot.json`: the immutable data commit SHA, SHA-256 checksum, byte count, publication timestamp and latest price date. The local `data/snapshots/research.db.gz` is ignored by Git. Existing binary revisions in main's history remain; this migration does not rewrite or shrink that history.

There are two data-only branches. Each points to a **single orphan commit** whose only file is `research.db.gz`:

- `data-snapshot`: the newest packed snapshot.
- `data-snapshot-previous`: the exact commit main referenced immediately before publication, with its SHA unchanged.

For each refresh, Actions fetches and verifies main's pinned snapshot first. After refresh and validation, publication is ordered:

1. Check main has not changed since checkout; otherwise fail and retry from the latest main.
2. Point `data-snapshot-previous` at the exact commit in main's pointer.
3. Force-with-lease push a new, parentless data commit to `data-snapshot`.
4. Update only `data/snapshot.json`, then make a normal, non-force push to main to trigger Vercel.

If the pointer push fails, main's old SHA remains reachable on `data-snapshot-previous`. A retry preserves the SHA **main actually references**, not the last attempted data tip. Do not hand-edit the pointer or independently update the data branches while a refresh is running; the serialized workflow owns publication.

The two data branches retain at most **two reachable snapshot commits**, about **76 MB** if both snapshots are today's size, rather than another permanent 38 MB revision per refresh. Old unreachable objects may remain on GitHub until its garbage collection runs, so reported repository storage will not necessarily shrink immediately. Explicitly checking out main does not pull data-branch blobs; a normal all-branches clone can include both snapshots. Database growth can still make each individual snapshot larger.

`npm run build` runs `prebuild`, which downloads from the public, commit-pinned URL `https://raw.githubusercontent.com/Andyyooi/genesis/<commit>/research.db.gz`. No token or new Vercel configuration is needed. An already matching local file skips the download. A network failure, wrong size or checksum fails the build; a download is renamed into place only after verification. `npm run dev` fetches only when the local gzip is missing; use `npm run snapshot:fetch` to explicitly verify/update an existing local copy.

The build creates and bundles a smaller copy. Builds and refreshes keep the full scoring evidence for each stock's latest score and the current Top Picks publication, but retain only the score and summary fields for older runs. Price history, company accounts, fair ranges and the Track record are unchanged. A snapshot over 350 MiB unpacked or 95 MiB compressed is rejected before deployment or publication, so the previous deployment can keep serving.

## Check data health

While signed in, open [Data health](https://genesisresearch.vercel.app/api/health). It reports the latest usable saved closing date (`asOfDate`), the previous available session date (`previousPriceDate`), the number of listed names with usable Yahoo closes on both dates (`freshPriceCount`), the total listed names (`listedCount`), and the compressed size of the snapshot actually served (`snapshotBytes`, or null for a writable local database).

The same warning appears across signed-in pages if fewer than 90% of listed names have both closes, or the newest close is more than four calendar days old in Malaysia (or missing). The grace period avoids a warning over ordinary weekends; longer market holidays may still trigger it. The endpoint returns HTTP 200 with `status: "degraded"` for these data warnings, and HTTP 503 with `status: "unavailable"` if it cannot read the data. Prices and rankings are not changed by the check.
