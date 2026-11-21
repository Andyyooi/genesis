const myr = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

const sharePrice = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/** Bursa closes can include half-sen ticks; do not round them to whole sen. */
export function formatSharePrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return "Data unavailable";
  }
  return sharePrice.format(value);
}

/** Format a MYR amount. Returns "Data unavailable" for null (no invented prices). */
export function formatMyr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Data unavailable";
  }
  return myr.format(value);
}
