import Link from "next/link";
import { AlertsList } from "@/components/alerts/alerts-list";
import { DataLagBanner } from "@/components/research/data-lag-banner";
import { storedSnapshotDates } from "@/lib/stored-snapshot-dates";
import { loadRecentAlerts } from "@/alerts/refresh";
import { loadAlertRefreshStatus } from "@/alerts/publication";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  const rows = loadRecentAlerts(50);
  const dates = storedSnapshotDates();
  const refresh = loadAlertRefreshStatus();
  const empty = !refresh?.alerts
    ? "Alerts have not been regenerated for this publication. Run Refresh data to compare published runs; old-method alerts are not shown."
    : !refresh.alerts.previousRunDate
      ? "No previous published run exists to compare. No change alerts are invented; the next refresh will compare against this run."
      : `No qualifying score, top-pick, exclusion or fair-value safety changes: previous run ${refresh.alerts.previousRunDate} → this run's price date ${refresh.alerts.priceDate ?? "unavailable"}.`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Dashboard
        </Link>

      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
        {refresh ? <p className="text-sm font-medium">Alerts from refresh of {refresh.asOf.slice(0, 10)}</p> : null}
        <p className="text-muted-foreground">
          Changes since the previous published run. Only the latest refresh is retained. Open an alert to see the company, or expand its explanation.
        </p>
      </header>
      <p className="text-sm text-muted-foreground">Universe-wide latest stored dates; individual companies can have older accounts.</p>
      {dates ? <DataLagBanner dates={dates} /> : <p>No published research run is available.</p>}
      <AlertsList
        rows={rows}
        empty={empty}
      />
    </main>
  );
}
