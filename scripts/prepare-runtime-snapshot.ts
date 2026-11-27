import { join } from "node:path";
import { RUNTIME_SNAPSHOT_GZ_REL, SNAPSHOT_GZ_REL } from "@/db/snapshot-file";
import { prepareRuntimeSnapshot } from "@/snapshot/compact";

prepareRuntimeSnapshot(join(process.cwd(), SNAPSHOT_GZ_REL), join(process.cwd(), RUNTIME_SNAPSHOT_GZ_REL))
  .then(({ bytes, unpackedBytes }) => console.log(`Deployment snapshot: ${bytes} bytes compressed, ${unpackedBytes} bytes unpacked.`))
  .catch((error) => {
    console.error("Deployment snapshot preparation failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
