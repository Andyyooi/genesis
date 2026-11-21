import { isSnapshotReadOnly } from "@/lib/data-mode";

export function SnapshotBanner() {
  if (!isSnapshotReadOnly()) return null;
  return (
    <details className="border-b bg-secondary/50 px-4 py-2 text-center text-xs text-muted-foreground">
      <summary className="cursor-pointer">Published data · not live <span className="ml-2 underline">How updates work</span></summary>
      <p className="mx-auto mt-2 max-w-2xl leading-relaxed">Refresh data requests a new publication. Updated prices and accounts appear after publishing finishes; the website does not download live prices.</p>
    </details>
  );
}
