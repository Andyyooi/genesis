import { refuseSnapshotWrites } from "@/lib/data-mode";
import { importYahooFundamentals } from "./ingest-fundamentals-yahoo";
import {
  buildFundamentalsQualityReport,
  persistFundamentalsQualityReport,
} from "./fundamentals-quality";
import { rescoreListedMarket, runMarketScan } from "./scan";

async function main() {
  if (refuseSnapshotWrites("market scan / fundamentals ingest")) {
    process.exitCode = 1;
    return;
  }
  const mode = process.argv[2] ?? "scan";
  if (mode === "rescore") {
    console.log(JSON.stringify(rescoreListedMarket(), null, 2));
    return;
  }
  if (mode === "fundamentals") {
    const ingest = await importYahooFundamentals();
    const quality = persistFundamentalsQualityReport(buildFundamentalsQualityReport());
    console.log(
      JSON.stringify(
        {
          ingest: {
            ...ingest,
            failed: ingest.failed.slice(0, 40),
            failedCount: ingest.failed.length,
          },
          quality,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (mode === "report") {
    console.log(JSON.stringify(persistFundamentalsQualityReport(buildFundamentalsQualityReport()), null, 2));
    return;
  }
  const summary = await runMarketScan();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
