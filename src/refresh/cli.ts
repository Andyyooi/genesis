import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { formatDailyRefreshSummary, runDailyRefresh, type DailyRefreshDeps } from "@/refresh/daily";

/** Maps CLI args to refresh options. `--skip-rescore` does not invoke rescoreListedMarket. */
export function dailyRefreshOptionsFromArgv(argv: string[]): Pick<DailyRefreshDeps, "skipRescore"> {
  return { skipRescore: argv.includes("--skip-rescore") };
}

/** True only when this file is the process entrypoint, not when tests import it. */
export function isRefreshCliProcess(entry = process.argv[1], moduleUrl = import.meta.url) {
  if (!entry) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return moduleUrl === pathToFileURL(entry).href;
  }
}

async function main() {
  if (refuseSnapshotWrites("refresh:daily")) {
    process.exitCode = 1;
    return;
  }
  const summary = await runDailyRefresh(dailyRefreshOptionsFromArgv(process.argv));
  console.log(formatDailyRefreshSummary(summary));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.overallStatus === "SOURCE_FAILED") process.exitCode = 1;
}

if (isRefreshCliProcess()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
