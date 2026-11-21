import { getSqlite } from "@/db/client";
import { deployedSnapshotState } from "@/refresh/deployed-snapshot";
import { buildSnapshotDates } from "@/lib/snapshot-dates";

export function storedSnapshotDates() {
  const state = deployedSnapshotState();
  if (!state.publishedAt) return null;
  const annual = getSqlite().prepare("SELECT MAX(period_end) AS period FROM financial_periods WHERE statement_type = 'annual' AND actual_or_estimate = 'actual'").get() as { period: string | null };
  return buildSnapshotDates({ scoreAsOf: state.publishedAt, lastTradeDate: state.latestPriceDate, fundamentalsPeriod: annual.period });
}
