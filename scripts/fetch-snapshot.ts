import { isCliEntrypoint } from "@/cli/entrypoint";
import { fetchSnapshot } from "@/snapshot/fetch";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--if-missing")) throw new Error("Usage: fetch-snapshot.ts [--if-missing]");
  const result = await fetchSnapshot({ onlyIfMissing: args.includes("--if-missing") });
  console.log(`Snapshot ${result}: data/snapshots/research.db.gz`);
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error("Snapshot fetch failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
