import Link from "next/link";
import { AlertsList } from "@/components/alerts/alerts-list";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { storedSnapshotDates } from "@/lib/stored-snapshot-dates";
import { loadRecentAlerts } from "@/alerts/refresh";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const rows = loadRecentAlerts(50);
  const dates = storedSnapshotDates();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Dashboard
        </Link>
        {" · in-app alerts · not email · not a buy or sell"}
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground">
          Each item stores the rule and why it fired. Click through to the research page. Re-run
          ingest or <code className="font-mono text-sm">npm run alerts</code> after new files.
        </p>
      </header>
      <p className="text-sm text-muted-foreground">Universe-wide latest stored dates; individual companies can have older accounts.</p>
      {dates ? <DataLagBanner dates={dates} /> : <p>No published research run is available.</p>}
      <AlertsList
        rows={rows}
        empty="No alerts yet. Import announcements or run npm run alerts. Nothing is invented to fill this list."
      />
    </main>
  );
}
