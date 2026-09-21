import { refuseSnapshotWrites } from "@/lib/data-mode";
import { assignResearchProfiles } from "./assign-profiles";

if (refuseSnapshotWrites("profile classify")) {
  process.exitCode = 1;
} else {
  const result = assignResearchProfiles();
  console.log(JSON.stringify({ kind: "research-profiles", ...result }, null, 2));
}
