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

export function movingAverage(points: PricePoint[], window: number): PricePoint[] {
  let sum = 0;
  let count = 0;
  return points.map(({ date, close }, index) => {
    if (validClose(close)) {
      sum += close;
      count++;
    }
    const leaving = points[index - window]?.close;
    if (validClose(leaving)) {
      sum -= leaving;
      count--;
    }
    return { date, close: count === window ? sum / window : null };
  });
}

const dayMs = 86_400_000;
const dateTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function calendarDateTicks(points: PricePoint[]) {
  const start = dateTime(points[0]?.date ?? "");
  const end = dateTime(points.at(-1)?.date ?? "");
  if (!(end > start)) return [];
  const long = end - start > 366 * dayMs;
  const format = new Intl.DateTimeFormat("en-GB", {
    ...(long ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" }),
    timeZone: "UTC",
  });
  const count = Math.min(4, (end - start) / dayMs);
  return Array.from({ length: count + 1 }, (_, index) => {
    const fraction = index / count;
    const stamp = start + Math.round((end - start) * fraction / dayMs) * dayMs;
    return {
      date: new Date(stamp).toISOString().slice(0, 10),
      label: format.format(stamp),
      fraction: (stamp - start) / (end - start),
      compact: count === 4 ? index % 2 === 0 : count !== 3 || index !== 2,
    };
  });
}

/** Missing closes break each line. Sparklines keep evenly spaced observations. */
export function pricePlot(
  points: PricePoint[],
  width = 240,
  height = 64,
  padding = 4,
  options: { calendar?: boolean; overlays?: PricePoint[][] } = {},
) {
  const values = points.map((point) => point.close).filter(validClose);
  if (values.length < 2) return null;
  const overlays = options.overlays ?? [];
  const allValues = values.concat(overlays.flatMap((series) => series.map((point) => point.close).filter(validClose)));
  const low = Math.min(...allValues);
  const high = Math.max(...allValues);
  const spread = high - low || high * 0.02;
  const min = low - spread * 0.12;
  const max = high + spread * 0.12;
  const dates = options.calendar ? points.map((point) => dateTime(point.date)) : [];
  const dateSpan = (dates.at(-1) ?? 0) - (dates[0] ?? 0);
  const xAtFraction = (fraction: number) => padding + fraction * (width - padding * 2);
  const x = (index: number) => xAtFraction(dateSpan > 0
    ? (dates[index] - dates[0]) / dateSpan
    : index / Math.max(1, points.length - 1));
  const nearestIndex = (coordinate: number) => {
    let nearest = 0;
    let distance = Infinity;
    for (const [index, point] of points.entries()) {
      if (!validClose(point.close)) continue;
      const next = Math.abs(x(index) - coordinate);
      if (next < distance) {
        distance = next;
        nearest = index;
      }
    }
    return nearest;
  };
  const y = (close: number) =>
    height - padding - ((close - min) / (max - min)) * (height - padding * 2);
  const pathFor = (series: PricePoint[]) => {
    let connected = false;
    return series
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
  };
  return { path: pathFor(points), overlayPaths: overlays.map(pathFor), min, max, x, y, xAtFraction, nearestIndex };
}
