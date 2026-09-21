import { getDb } from "@/db/client";
import { scoreRuns } from "@/db/schema";
import type { ScoreResult } from "@/scoring/types";

export function persistScoreRun(args: {
  instrumentId: number;
  result: ScoreResult;
}) {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.insert(scoreRuns)
    .values({
      instrumentId: args.instrumentId,
      asOf: args.result.asOf,
      configHash: args.result.configHash,
      instrumentProfile: args.result.profile,
      researchScore: args.result.researchScore,
      valuationScore: args.result.valuationScore,
      categoryScoresJson: JSON.stringify(
        args.result.categories.map((c) => ({
          id: c.id,
          score: c.score,
          coverage: c.coverage,
          configuredWeight: c.configuredWeight,
          liveWeight: c.liveWeight,
          inThisRun: c.inThisRun,
          warning: c.warning,
        })),
      ),
      coverageJson: JSON.stringify(args.result.dataCoverage),
      dataConfidence: args.result.dataConfidence.level,
      evidenceJson: JSON.stringify({
        factors: args.result.categories.flatMap((c) => c.factors),
        concerns: args.result.concerns,
        notes: args.result.notes,
        dataConfidence: args.result.dataConfidence,
      }),
      createdAt,
    })
    .run();
}
