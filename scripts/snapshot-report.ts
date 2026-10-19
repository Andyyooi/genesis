import { isCliEntrypoint } from "@/cli/entrypoint";
import { snapshotGzPath } from "@/db/snapshot-file";
import { parseSnapshotArgs } from "@/snapshot/args";
import { formatSnapshotReport, SnapshotRejected, validateSnapshotArtifact } from "@/snapshot/publish";

function main() {
  const args = parseSnapshotArgs(process.argv.slice(2));
  if (!args.artifact) {
    throw new SnapshotRejected({
      stage: "refused",
      deployed: false,
      sourcePath: args.source ?? null,
      artifactPath: null,
      sourcePackable: false,
      artifactValidated: false,
      integrity: "not-read",
      instrumentCount: null,
      watchlistCount: null,
      effectiveWatchlistCount: null,
      financialPeriodCount: null,
      priceBarCount: null,
      latestPriceDate: null,
      latestFinancialPeriod: null,
      scoreRunCount: null,
      fairValueRunCount: null,
      unsupportedFairValueCount: null,
      noValueFairValueCount: null,
      loaderCompatible: null,
      artifactBytes: null,
      differsFromCurrent: null,
      currentSnapshotPath: null,
      warnings: [],
      blockers: ["A candidate artifact is required. Pass --artifact. This report does not deploy the website."],
    });
  }
  const report = validateSnapshotArtifact({
    artifactPath: args.artifact,
    sourcePath: args.source,
    currentSnapshotPath: args.current ?? snapshotGzPath(),
  });
  console.log(formatSnapshotReport(report));
}

if (isCliEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof SnapshotRejected) console.error(formatSnapshotReport(error.report));
    else console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
