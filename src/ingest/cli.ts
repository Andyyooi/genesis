import { join } from "node:path";
import { fillYahooAvailableAt } from "./fill-available-at";
import { importAnnouncementsCsv } from "./import-announcements";
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

  if (action === "announcements" || action === "events") {
    const file = arg ?? join(process.cwd(), "data/raw/announcements-sample.csv");
    printReport(importAnnouncementsCsv(file));
    return;
  }

  if (action === "available-at" || action === "filings") {
    const tickers = arg ? arg.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean) : undefined;
    printReport(await fillYahooAvailableAt(tickers ? { tickers } : undefined));
    return;
  }
    printReport(await importYahooPrices(arg));
    return;
  }

  if (action === "all") {
    const file = arg ?? join(process.cwd(), "data/raw/fundamentals-sample.csv");
    printReport(importFundamentalsCsv(file));
    printReport(importAnnouncementsCsv(join(process.cwd(), "data/raw/announcements-sample.csv")));
    printReport(await importYahooPrices());
    return;
  }

  console.error("Usage: npm run ingest -- [all|fundamentals|announcements|prices|available-at] [file-or-ticker]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
