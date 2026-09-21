import {
  assessObservationFreshness,
  extractIsoDate,
  freshnessBand,
  monthsBetween,
} from "@/scoring/freshness";
import type {
  CategoryScore,
  DataConfidence,
  DataConfidenceLevel,
  DataCoverage,
} from "@/scoring/types";

export const CORE_SCORE_CATEGORIES = ["valuation", "quality", "financial_health", "growth"] as const;

export function formatCoverageSummary(coverage: DataCoverage): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const expected = coverage.expected;
  if (expected === 0) {
    return "No expected core factors in this profile.";
  }
  return `Coverage ${pct(coverage.coverageRatio)} (${coverage.available} of ${expected} core factors) · fresh ${pct(coverage.freshCount / expected)} · stale ${pct((coverage.staleCount + coverage.veryStaleCount) / expected)}`;
}

export function assessDataQuality(args: {
  asOf: string;
  categories: CategoryScore[];
  researchScore: number | null;
  valuationScore: number | null;
  latestAnnual?: { periodEnd: string; availableAt: string | null } | null;
}): { dataCoverage: DataCoverage; dataConfidence: DataConfidence } {
  const core = args.categories.filter(
    (c) =>
      (CORE_SCORE_CATEGORIES as readonly string[]).includes(c.id) && c.totalFactorWeights > 0,
  );
  const expectedFactors = core.flatMap((c) => c.factors);
  const expected = expectedFactors.length;
  const availableFactors = expectedFactors.filter((f) => f.available && f.score !== null);
  const available = availableFactors.length;
  const unavailable = expected - available;

  let freshCount = 0;
  let agingCount = 0;
  let staleCount = 0;
  let veryStaleCount = 0;
  let unknownCount = 0;
  for (const factor of availableFactors) {
    const date = extractIsoDate(factor.period);
    const band = freshnessBand(date ? monthsBetween(args.asOf, date) : null);
    if (band === "FRESH") freshCount += 1;
    else if (band === "AGING") agingCount += 1;
    else if (band === "STALE") staleCount += 1;
    else if (band === "VERY_STALE") veryStaleCount += 1;
    else unknownCount += 1;
  }

  const fromFiling = args.latestAnnual
    ? assessObservationFreshness({
        asOf: args.asOf,
        periodEnd: args.latestAnnual.periodEnd,
        availableAt: args.latestAnnual.availableAt,
      })
    : null;

  let observationDate = fromFiling?.observationDate ?? null;
  let ageMonths = fromFiling?.ageMonths ?? null;
  let freshness: FreshnessBand = fromFiling?.band ?? "UNKNOWN";

  if (!args.latestAnnual) {
    const dates = availableFactors
      .map((f) => extractIsoDate(f.period))
      .filter((d): d is string => Boolean(d))
      .sort();
    const newest = dates[dates.length - 1] ?? null;
    if (newest) {
      ageMonths = monthsBetween(args.asOf, newest);
      freshness = freshnessBand(ageMonths);
      observationDate = newest;
    }
  }

  const coverageRatio = expected === 0 ? 0 : available / expected;
  const dataCoverage: DataCoverage = {
    expected,
    available,
    unavailable,
    coverageRatio,
    freshCount,
    agingCount,
    staleCount,
    veryStaleCount,
    unknownCount,
    freshness,
    periodEnd: args.latestAnnual?.periodEnd ?? observationDate,
    availableAt: args.latestAnnual?.availableAt ?? null,
    ageMonths,
  };

  const dataConfidence = assignConfidence({
    coverage: dataCoverage,
    categories: args.categories,
    researchScore: args.researchScore,
    valuationScore: args.valuationScore,
  });

  return { dataCoverage, dataConfidence };
}

function assignConfidence(args: {
  coverage: DataCoverage;
  categories: CategoryScore[];
  researchScore: number | null;
  valuationScore: number | null;
}): DataConfidence {
  const { coverage } = args;
  const reasons: string[] = [];
  const highScore =
    (args.researchScore ?? 0) >= 80 || (args.valuationScore ?? 0) >= 80;
  const valuationLive = args.categories.find((c) => c.id === "valuation")?.score != null;
  const qualityLive = args.categories.find((c) => c.id === "quality")?.score != null;

  reasons.push(
    `${coverage.available} of ${coverage.expected} expected core factors are available (valuation, quality, health, growth). Unavailable factors are omitted, not scored as zero.`,
  );
  reasons.push(
    coverage.freshness === "UNKNOWN"
      ? "No period-end or filing date on the latest annual used, so freshness is unknown. Ingestion time is not used as financial age."
      : `Latest annual is ${coverage.freshness.toLowerCase().replaceAll("_", " ")} (${coverage.ageMonths ?? "?"} months from period-end or filing date, not from download time). Period-end ${coverage.periodEnd ?? "unknown"}${coverage.availableAt ? `; filed ${coverage.availableAt}` : ""}.`,
  );
  if (coverage.staleCount + coverage.veryStaleCount > 0) {
    reasons.push(
      `${coverage.staleCount + coverage.veryStaleCount} available core factor(s) use a stale or very stale period.`,
    );
  }
  if (!valuationLive) reasons.push("Valuation is missing from the live mix.");
  if (!qualityLive) reasons.push("Business quality is missing from the live mix.");
  if (highScore && coverage.available <= 2) {
    reasons.push(
      "An 80+ Research or Valuation score is coming from only one or two available core factors after renormalization.",
    );
  }

  let level: DataConfidenceLevel;
  if (
    coverage.expected === 0 ||
    coverage.available === 0 ||
    coverage.freshness === "UNKNOWN" ||
    coverage.freshness === "VERY_STALE" ||
    (highScore && coverage.available <= 1)
  ) {
    level = "VERY_LOW";
    if (coverage.available === 0) reasons.push("Almost no core fundamentals are available.");
    if (coverage.freshness === "VERY_STALE") {
      reasons.push("Filings this old should not be read as a current picture of the business.");
    }
  } else if (
    coverage.coverageRatio < 0.5 ||
    coverage.freshness === "STALE" ||
    (highScore && coverage.available <= 2)
  ) {
    level = "LOW";
  } else if (
    coverage.coverageRatio >= 2 / 3 &&
    (coverage.freshness === "FRESH" || coverage.freshness === "AGING") &&
    coverage.available >= 4 &&
    valuationLive &&
    qualityLive
  ) {
    level = "HIGH";
    reasons.push("Coverage, freshness, and factor count support reading the raw scores with this snapshot.");
  } else {
    level = "MEDIUM";
  }

  const needsVerification =
    highScore && (level === "LOW" || level === "VERY_LOW" || coverage.available <= 2);

  if (needsVerification) {
    reasons.push("High score — needs verification (thin coverage, stale filings, or a stub factor set).");
  }

  return { level, reasons, needsVerification };
}
