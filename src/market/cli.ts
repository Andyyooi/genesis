import { runMarketScan } from "./scan";

async function main() {
  const summary = await runMarketScan();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
