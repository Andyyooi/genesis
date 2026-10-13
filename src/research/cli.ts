import { isCliEntrypoint } from "@/cli/entrypoint";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { assignResearchProfiles } from "./assign-profiles";

function main() {
  if (refuseSnapshotWrites("profile classify")) {
    process.exitCode = 1;
    return;
  }
  const result = assignResearchProfiles();
  console.log(JSON.stringify({ kind: "research-profiles", ...result }, null, 2));
}

if (isCliEntrypoint(import.meta.url)) main();
