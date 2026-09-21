import { ingestPhase16Events, PHASE16_EVENT_TICKERS } from "@/events/ingest";

async function main() {
  const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
  const report = await ingestPhase16Events({
    tickers: tickers.length ? tickers : [...PHASE16_EVENT_TICKERS],
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
