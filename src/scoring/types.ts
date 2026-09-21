export type FactorEvidence = {
  id: string;
  label: string;
  category: string;
  weight: number;
  metricId: string;
  value: number | null;
  score: number | null;
  available: boolean;
  reason: string | null;
  period: string | null;
  formula: string;
  inputs: { name: string; value: number | null; period?: string | null }[];
  notes: string | null;
};

export type CategoryScore = {
  id: string;
  configuredWeight: number;
  liveWeight: number | null;
  score: number | null;
  coverage: number;
  availableFactorWeights: number;
  totalFactorWeights: number;
  inThisRun: boolean;
  warning: string | null;
  factors: FactorEvidence[];
};

export type ConcernHit = {
  id: string;
  label: string;
  message: string;
  metricId: string | null;
  value: number | null;
  period: string | null;
};

export type FreshnessBand = "FRESH" | "AGING" | "STALE" | "VERY_STALE" | "UNKNOWN";

export type DataConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

/** Count-based coverage of core scoring factors. Not a fake precision percentage. */
export type DataCoverage = {
  expected: number;
  available: number;
  unavailable: number;
  coverageRatio: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
  veryStaleCount: number;
  unknownCount: number;
  freshness: FreshnessBand;
  periodEnd: string | null;
  availableAt: string | null;
  ageMonths: number | null;
};

export type DataConfidence = {
  level: DataConfidenceLevel;
  reasons: string[];
  needsVerification: boolean;
};

export type ScoreResult = {
  asOf: string;
  configHash: string;
  profile: "default" | "reit" | "bank";
  researchScore: number | null;
  valuationScore: number | null;
  categories: CategoryScore[];
  concerns: ConcernHit[];
  notes: string[];
  dataCoverage: DataCoverage;
  dataConfidence: DataConfidence;
};
