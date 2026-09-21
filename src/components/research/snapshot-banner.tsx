import { isSnapshotReadOnly } from "@/lib/data-mode";

export function SnapshotBanner() {
  if (!isSnapshotReadOnly()) return null;
  return (
    <div className="border-b bg-muted/60 px-4 py-2 text-center text-sm">
      Static SQLite snapshot. Scoring and research pages use stored data only. Ingest, daily
      prices, and market scan writes are disabled on this host — they would not persist on Vercel.
    </div>
  );
}
