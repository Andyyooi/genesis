import { loadInstrumentSnapshots } from "@/db/queries";
import { snapshotsToMetrics } from "@/metrics/from-snapshots";

function main() {
  const ticker = (process.argv[2] ?? "MAYBANK").toUpperCase();
  const data = loadInstrumentSnapshots(ticker);
  if (!data) {
    console.error(`No instrument ${ticker} in SQLite. Seed universe and import first.`);
    process.exitCode = 1;
    return;
  }

  const metrics = snapshotsToMetrics({
    instrumentType: data.instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
    periods: data.periods,
    bars: data.bars,
  });

  const payload = {
    ticker: data.instrument.ticker,
    name: data.instrument.name,
    instrumentType: data.instrument.instrumentType,
    scores: "none — Phase 3 metrics only",
    available: metrics.filter((m) => m.available).map((m) => m.id),
    unavailable: metrics.filter((m) => !m.available).map((m) => ({ id: m.id, reason: m.reason })),
    metrics,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main();
