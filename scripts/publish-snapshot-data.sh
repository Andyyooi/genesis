#!/usr/bin/env bash
set -euo pipefail

git fetch --no-tags origin main:refs/remotes/origin/main >&2
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse refs/remotes/origin/main)" ]]; then
  echo "Refusing publication: main changed during refresh; retry from the latest main" >&2
  exit 1
fi
previous=$(git show refs/remotes/origin/main:data/snapshot.json | node -pe 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).commit')
if [[ ! "$previous" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid snapshot commit in main pointer" >&2
  exit 1
fi

previous_tip=$(git ls-remote --heads origin refs/heads/data-snapshot-previous | cut -f1)
data_tip=$(git ls-remote --heads origin refs/heads/data-snapshot | cut -f1)
git fetch --no-tags origin "$previous" >&2
git push --force-with-lease="refs/heads/data-snapshot-previous:$previous_tip" origin "$previous:refs/heads/data-snapshot-previous" >&2

blob=$(git hash-object -w data/snapshots/research.db.gz)
vercel_blob=$(printf '%s\n' '{"git":{"deploymentEnabled":false}}' | git hash-object -w --stdin)
tree=$(printf '100644 blob %s\t%s\n' "$blob" research.db.gz "$vercel_blob" vercel.json | git mktree)
commit=$(git commit-tree "$tree" -m "data: refresh snapshot as of $(date -u +%Y-%m-%d)")
git push --force-with-lease="refs/heads/data-snapshot:$data_tip" origin "$commit:refs/heads/data-snapshot" >&2
printf '%s\n' "$commit"
