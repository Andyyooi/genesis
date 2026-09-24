import { refuseSnapshotWrites } from "@/lib/data-mode";
import { formatDailyRefreshSummary, runDailyRefresh } from "@/refresh/daily";

async function main() {
  if (refuseSnapshotWrites("refresh:daily")) {
    process.exitCode = 1;
    return;
  }
  const skipRescore = process.argv.includes("--skip-rescore");
  const summary = await runDailyRefresh({
    rescore: skipRescore ? () => ({ kind: "rescore-skipped" }) : undefined,
  });
  console.log(formatDailyRefreshSummary(summary));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.overallStatus === "SOURCE_FAILED") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
