import { scoreTicker } from "./run-ticker";

function main() {
  const ticker = (process.argv[2] ?? "MAYBANK").toUpperCase();
  const scored = scoreTicker(ticker, true);
  if (!scored) {
    console.error(`No instrument ${ticker}. Import universe snapshots first.`);
    process.exitCode = 1;
    return;
  }
  const { result } = scored;
  console.log(
    JSON.stringify(
      {
        ticker: scored.ticker,
        profile: result.profile,
        configHash: result.configHash,
        researchScore: result.researchScore,
        valuationScore: result.valuationScore,
        dataConfidence: result.dataConfidence,
        dataCoverage: result.dataCoverage,
        categories: result.categories.map((c) => ({
          id: c.id,
          score: c.score,
          coverage: c.coverage,
          configuredWeight: c.configuredWeight,
          liveWeight: c.liveWeight,
          inThisRun: c.inThisRun,
          warning: c.warning,
        })),
        concerns: result.concerns,
        notes: result.notes,
        persisted: true,
      },
      null,
      2,
    ),
  );
}

main();
