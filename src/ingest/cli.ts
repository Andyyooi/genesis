import { join } from "node:path";
import { importFundamentalsCsv } from "./import-fundamentals";
import { importYahooPrices } from "./import-prices";

function printReport(report: unknown) {
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const [, , command, arg] = process.argv;
  const action = command ?? "all";

  if (action === "fundamentals") {
    const file = arg ?? join(process.cwd(), "data/raw/fundamentals-sample.csv");
    printReport(importFundamentalsCsv(file));
    return;
  }

  if (action === "prices") {
    printReport(await importYahooPrices(arg));
    return;
  }

  if (action === "all") {
    const file = arg ?? join(process.cwd(), "data/raw/fundamentals-sample.csv");
    printReport(importFundamentalsCsv(file));
    printReport(await importYahooPrices());
    return;
  }

  console.error("Usage: npm run ingest -- [all|fundamentals|prices] [file-or-ticker]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
