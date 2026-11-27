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

/** Fair-value estimates use half-sen precision to avoid overstating accuracy. */
export function formatFairEstimate(value: number): string {
  return formatSharePrice(Math.max(0.005, Math.round(value * 200) / 200));
}

export function formatFairRangeBounds({ low, high }: { low: number; high: number }): string {
  return `${formatFairEstimate(low)} to ${formatFairEstimate(high)}`;
}

/** Format a MYR amount. Returns "Data unavailable" for null (no invented prices). */
export function formatMyr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Data unavailable";
  }
  return myr.format(value);
}
