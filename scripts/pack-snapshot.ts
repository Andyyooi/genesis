import { isCliEntrypoint } from "@/cli/entrypoint";
import { liveSqlitePath } from "@/db/snapshot-file";
import { parseSnapshotArgs } from "@/snapshot/args";
import { formatSnapshotReport, packSnapshot, SnapshotRejected } from "@/snapshot/publish";

async function main() {
  const args = parseSnapshotArgs(process.argv.slice(2));
  const report = await packSnapshot({
    sourcePath: args.source ?? liveSqlitePath(),
    destPath: args.dest,
    dryRun: args.dryRun,
    writeProduction: args.writeProduction,
    currentSnapshotPath: args.current,
  });
  console.log(formatSnapshotReport(report));
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof SnapshotRejected) {
      console.error(formatSnapshotReport(error.report));
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  });
}
