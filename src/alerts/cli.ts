import { refuseSnapshotWrites } from "@/lib/data-mode";
import { refreshAlertsForUniverse } from "@/alerts/refresh";

function main() {
  if (refuseSnapshotWrites("alerts refresh")) {
    process.exitCode = 1;
    return;
  }
  const summary = refreshAlertsForUniverse();
  console.log(JSON.stringify({ kind: "alerts", summary }, null, 2));
}

main();
