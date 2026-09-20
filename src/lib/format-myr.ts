const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

/** Format a MYR amount. Returns "Data unavailable" for null (no invented prices). */
export function formatMyr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Data unavailable";
  }
  return myr.format(value);
}
