import { available, unavailable, type MetricValue, type PriceBarSnapshot } from "@/metrics/types";

function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  const next = new Date(ms + days * 24 * 3600 * 1000);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function priceMetrics(bars: PriceBarSnapshot[]): MetricValue[] {
  const withClose = bars
    .filter((bar) => bar.close !== null)
    .sort((a, b) => a.barDate.localeCompare(b.barDate));
  const last = withClose[withClose.length - 1];

  if (!last || last.close === null) {
    const empty = unavailable(
      "last_close",
      "Last close",
      "close of the latest stored bar",
      "No stored price bars with a close",
      [],
      null,
      "myr",
    );
    return [
      empty,
      unavailable("last_trade_date", "Last trade date", "date of the latest stored bar", empty.reason!, [], null),
      unavailable("week52_high", "52-week high", "max high (or close) in the 52-week window", empty.reason!, [], null, "myr"),
      unavailable("week52_low", "52-week low", "min low (or close) in the 52-week window", empty.reason!, [], null, "myr"),
      unavailable(
        "distance_from_52w_high",
        "Distance from 52-week high",
        "(52-week high − last close) / 52-week high",
        empty.reason!,
        [],
        null,
      ),
      unavailable(
        "distance_from_52w_low",
        "Distance from 52-week low",
        "(last close − 52-week low) / 52-week low",
        empty.reason!,
        [],
        null,
      ),
    ];
  }

  const windowStart = addDays(last.barDate, -365);
  const window = withClose.filter((bar) => bar.barDate >= windowStart && bar.barDate <= last.barDate);
  const period = `${windowStart} → ${last.barDate}`;

  const highs = window.map((bar) => bar.high ?? bar.close).filter((n): n is number => n !== null);
  const lows = window.map((bar) => bar.low ?? bar.close).filter((n): n is number => n !== null);
  const weekHigh = highs.length ? Math.max(...highs) : null;
  const weekLow = lows.length ? Math.min(...lows) : null;

  const lastClose = available(
    "last_close",
    "Last close",
    last.close,
    "myr",
    "close of the latest stored bar",
    [{ name: "close", value: last.close, period: last.barDate }],
    last.barDate,
  );

  const lastTrade = available(
    "last_trade_date",
    "Last trade date",
    null,
    "ratio",
    "ISO date of the latest stored bar (shown in period; no numeric price invented)",
    [{ name: "barDate", value: null, period: last.barDate }],
    last.barDate,
  );

  const highMetric =
    weekHigh === null
      ? unavailable("week52_high", "52-week high", "max high (or close) in the 52-week window", "No highs in window", [], period, "myr")
      : available(
          "week52_high",
          "52-week high",
          weekHigh,
          "myr",
          "max high (or close) in the 52-week window of stored bars",
          [{ name: "barsInWindow", value: window.length, period }],
          period,
        );

  const lowMetric =
    weekLow === null
      ? unavailable("week52_low", "52-week low", "min low (or close) in the 52-week window", "No lows in window", [], period, "myr")
      : available(
          "week52_low",
          "52-week low",
          weekLow,
          "myr",
          "min low (or close) in the 52-week window of stored bars",
          [{ name: "barsInWindow", value: window.length, period }],
          period,
        );

  const distHigh =
    weekHigh === null || weekHigh === 0
      ? unavailable(
          "distance_from_52w_high",
          "Distance from 52-week high",
          "(52-week high − last close) / 52-week high",
          weekHigh === 0 ? "Division by zero" : "52-week high is unavailable",
          [
            { name: "lastClose", value: last.close, period: last.barDate },
            { name: "week52High", value: weekHigh, period },
          ],
          period,
        )
      : available(
          "distance_from_52w_high",
          "Distance from 52-week high",
          (weekHigh - last.close) / weekHigh,
          "ratio",
          "(52-week high − last close) / 52-week high",
          [
            { name: "lastClose", value: last.close, period: last.barDate },
            { name: "week52High", value: weekHigh, period },
          ],
          period,
        );

  const distLow =
    weekLow === null || weekLow === 0
      ? unavailable(
          "distance_from_52w_low",
          "Distance from 52-week low",
          "(last close − 52-week low) / 52-week low",
          weekLow === 0 ? "Division by zero" : "52-week low is unavailable",
          [
            { name: "lastClose", value: last.close, period: last.barDate },
            { name: "week52Low", value: weekLow, period },
          ],
          period,
        )
      : available(
          "distance_from_52w_low",
          "Distance from 52-week low",
          (last.close - weekLow) / weekLow,
          "ratio",
          "(last close − 52-week low) / 52-week low",
          [
            { name: "lastClose", value: last.close, period: last.barDate },
            { name: "week52Low", value: weekLow, period },
          ],
          period,
        );

  return [lastClose, lastTrade, highMetric, lowMetric, distHigh, distLow];
}
