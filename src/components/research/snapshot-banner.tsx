import { isSnapshotReadOnly } from "@/lib/data-mode";

export function SnapshotBanner() {
  if (!isSnapshotReadOnly()) return null;
  return (
    <div className="border-b bg-muted/60 px-4 py-2 text-center text-sm">
      This website is serving a published SQLite snapshot. Refresh & Research does not fetch
      prices here. A local refresh stays on your computer until you pack a snapshot and deploy it.
    </div>
  );
}
