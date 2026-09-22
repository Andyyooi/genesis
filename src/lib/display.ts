/** Safe user-facing display helpers. Never render NaN/undefined as numbers. */

export function unavailableLabel(reason?: string | null): string {
  return reason?.trim() ? `Unavailable — ${reason.trim()}` : "Unavailable";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatScore100Safe(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "Unavailable";
  return `${value.toFixed(0)}/100`;
}

export function formatPercentSafe(
  value: number | null | undefined,
  digits = 0,
): string {
  if (!isFiniteNumber(value)) return "Unavailable";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDateSafe(value: string | null | undefined): string {
  if (!value || !String(value).trim()) return "Unavailable";
  return String(value).slice(0, 10);
}

export function displayOrUnavailable(
  value: string | number | null | undefined,
  format?: (n: number) => string,
): string {
  if (value === null || value === undefined) return "Unavailable";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Unavailable";
    return format ? format(value) : String(value);
  }
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined" || text === "NaN") {
    return "Unavailable";
  }
  return text;
}
