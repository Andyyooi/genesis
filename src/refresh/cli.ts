import { appendFileSync } from "node:fs";
import { isCliEntrypoint } from "@/cli/entrypoint";
import { importCompanyCalendar } from "@/ingest/import-calendar";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { formatDailyRefreshSummary, runDailyRefresh, type DailyRefreshDeps } from "@/refresh/daily";

/** Maps CLI args to refresh options. `--skip-rescore` does not invoke rescoreListedMarket. */
export function dailyRefreshOptionsFromArgv(argv: string[]): Pick<DailyRefreshDeps, "skipRescore"> {
  return { skipRescore: argv.includes("--skip-rescore") };
}

async function main() {
  if (refuseSnapshotWrites("refresh:daily")) {
    process.exitCode = 1;
    return;
  }
  const summary = await runDailyRefresh({ ...dailyRefreshOptionsFromArgv(process.argv), importCalendar: importCompanyCalendar });
  const text = formatDailyRefreshSummary(summary);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`text\n${text}\n\`\`\`\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.overallStatus === "SOURCE_FAILED") process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
