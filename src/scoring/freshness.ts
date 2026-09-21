/** Financial age uses filing/publication time when known, else period-end. Never ingestion time. */

export type FreshnessBand = "FRESH" | "AGING" | "STALE" | "VERY_STALE" | "UNKNOWN";

export function extractIsoDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

/** Calendar months from the observation date to asOf. Null if either date is missing. */
export function monthsBetween(asOfIso: string, observationIso: string): number | null {
  const asOf = Date.parse(asOfIso);
  const obs = Date.parse(
    observationIso.length <= 10 ? `${observationIso}T00:00:00.000Z` : observationIso,
  );
  if (!Number.isFinite(asOf) || !Number.isFinite(obs)) return null;
  const a = new Date(asOf);
  const o = new Date(obs);
  let months =
    (a.getUTCFullYear() - o.getUTCFullYear()) * 12 + (a.getUTCMonth() - o.getUTCMonth());
  if (a.getUTCDate() < o.getUTCDate()) months -= 1;
  return months;
}

export function freshnessBand(ageMonths: number | null): FreshnessBand {
  if (ageMonths === null) return "UNKNOWN";
  if (ageMonths < 18) return "FRESH";
  if (ageMonths < 30) return "AGING";
  if (ageMonths < 48) return "STALE";
  return "VERY_STALE";
}

/**
 * Observation clock for a filing: available_at (filing/publication) if present, else period_end.
 * retrieved_at is ignored even if passed by mistake.
 */
export function financialObservationDate(args: {
  periodEnd?: string | null;
  availableAt?: string | null;
  retrievedAt?: string | null;
}): string | null {
  void args.retrievedAt;
  return extractIsoDate(args.availableAt) ?? extractIsoDate(args.periodEnd);
}

export function assessObservationFreshness(args: {
  asOf: string;
  periodEnd?: string | null;
  availableAt?: string | null;
  retrievedAt?: string | null;
}): { observationDate: string | null; ageMonths: number | null; band: FreshnessBand } {
  const observationDate = financialObservationDate(args);
  const ageMonths = observationDate ? monthsBetween(args.asOf, observationDate) : null;
  return { observationDate, ageMonths, band: freshnessBand(ageMonths) };
}
