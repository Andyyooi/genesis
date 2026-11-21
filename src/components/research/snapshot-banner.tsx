import { isSnapshotReadOnly } from "@/lib/data-mode";

export function SnapshotBanner() {
  if (!isSnapshotReadOnly()) return null;
  return (
    <div className="border-b bg-muted/60 px-4 py-2 text-center text-sm">
      This website serves a published SQLite snapshot. Use Refresh data above to request a GitHub Actions refresh;
      the updated snapshot appears after Vercel redeploys. No prices are downloaded by this website.
    </div>
  );
}
