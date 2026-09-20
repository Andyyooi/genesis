import Link from "next/link";
import { AlertsList } from "@/components/alerts/alerts-list";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { loadWatchlist } from "@/db/queries";
import { buildSnapshotDates } from "@/lib/snapshot-dates";
import { countAlerts, loadRecentAlerts, refreshAlertsForUniverse } from "@/alerts/refresh";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  if (countAlerts() === 0) {
    refreshAlertsForUniverse();
  }
  const rows = loadRecentAlerts(50);
  const watch = loadWatchlist();
  const sample = watch.find((row) => row.ticker === "MAYBANK") ?? watch[0];
  const dates = sample
    ? buildSnapshotDates({
        scoreAsOf: new Date().toISOString(),
        lastTradeDate: sample.lastTradeDate,
        fundamentalsPeriod: sample.ticker === "MAYBANK" ? "2024-12-31" : null,
      })
    : null;

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
      {dates ? <DataLagBanner dates={dates} /> : null}
      <AlertsList
        rows={rows}
        empty="No alerts yet. Import announcements or run npm run alerts. Nothing is invented to fill this list."
      />
    </main>
  );
}
