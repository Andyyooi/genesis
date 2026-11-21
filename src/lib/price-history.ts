export type PricePoint = { date: string; close: number | null };
export type PriceRange = "1M" | "3M" | "6M" | "1Y" | "ALL";

export type MarketPricePair = {
  date: string | null;
  close: number | null;
  previousClose: number | null;
};

/** Only same-date, valid pairs contribute to the published market pulse. */
export function summariseMarketPrices(rows: MarketPricePair[]) {
  const date =
    rows
      .flatMap((row) => (row.date ? [row.date] : []))
      .sort()
      .at(-1) ?? null;
  let higher = 0;
  let lower = 0;
  let unchanged = 0;
  for (const row of rows) {
    if (
      row.date !== date ||
      !validClose(row.close) ||
      !validClose(row.previousClose)
    )
      continue;
    if (row.close > row.previousClose) higher++;
    else if (row.close < row.previousClose) lower++;
    else unchanged++;
  }
  const covered = higher + lower + unchanged;
  return {
    date,
    total: rows.length,
    higher,
    lower,
    unchanged,
    covered,
    missing: rows.length - covered,
  };
}

/** Calendar ranges end at the last saved date, not today's (possibly much later) date. */
export function selectPriceRange(
  points: PricePoint[],
  range: PriceRange,
): PricePoint[] {
  if (range === "ALL" || points.length === 0) return points;
  const end = new Date(`${points[points.length - 1]!.date}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return [];
  const months = range === "1Y" ? 12 : Number.parseInt(range, 10);
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months);
  const daysInMonth = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  start.setUTCDate(Math.min(end.getUTCDate(), daysInMonth));
  const cutoff = start.toISOString().slice(0, 10);
  return points.filter((point) => point.date >= cutoff);
}

export function validClose(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Compare the actual endpoints, never substitute an earlier close for a missing one. */
export function priceChange(points: PricePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]!.close;
  const last = points[points.length - 1]!.close;
  return validClose(first) && validClose(last)
    ? (last / first - 1) * 100
    : null;
}

export function latestPriceChange(points: PricePoint[]): number | null {
  return priceChange(points.slice(-2));
}

export function formatPriceChange(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return "Unavailable";
  return `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
}

/** Trading observations are equally spaced; missing closes break the line. */
export function pricePlot(
  points: PricePoint[],
  width = 240,
  height = 64,
  padding = 4,
) {
  const values = points.map((point) => point.close).filter(validClose);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low || high * 0.02;
  const min = low - spread * 0.12;
  const max = high + spread * 0.12;
  const x = (index: number) =>
    padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
  const y = (close: number) =>
    height - padding - ((close - min) / (max - min)) * (height - padding * 2);
  let connected = false;
  const path = points
    .map((point, index) => {
      if (!validClose(point.close)) {
        connected = false;
        return "";
      }
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${x(index).toFixed(2)},${y(point.close).toFixed(2)}`;
    })
    .join(" ");
  return { path, min, max, x, y };
}
