import { rescoreListedMarket, runMarketScan } from "./scan";

async function main() {
  const mode = process.argv[2] ?? "scan";
  if (mode === "rescore") {
    const summary = rescoreListedMarket();
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const summary = await runMarketScan();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
