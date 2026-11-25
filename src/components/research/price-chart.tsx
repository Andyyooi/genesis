"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { formatSharePrice } from "@/lib/format-myr";
import {
  calendarDateTicks,
  formatPriceChange,
  movingAverage,
  priceChange,
  pricePlot,
  selectPriceRange,
  validClose,
  type PricePoint,
  type PriceRange,
} from "@/lib/price-history";

const ranges: PriceRange[] = ["1M", "3M", "6M", "1Y", "ALL"];
const indicators = [
  { window: 50, colour: "#29b6e3" },
  { window: 200, colour: "#fbac51" },
] as const;
const plotWidth = 730;
const plotHeight = 210;
const plotPadding = 12;

export function PriceChart({
  ticker,
  points,
}: {
  ticker: string;
  points: PricePoint[];
}) {
  const [range, setRange] = useState<PriceRange>("3M");
  const [inspection, setInspection] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [enabled, setEnabled] = useState<number[]>(() => indicators.map((indicator) => indicator.window));
  const chartId = useId();
  const selected = selectPriceRange(points, range);
  const averages = useMemo(() => indicators.map(({ window }) => movingAverage(points, window)), [points]);
  const availableIndicators = averages.map((series) => series.some((point) => validClose(point.close)));
  const active = indicators.flatMap((indicator, index) => {
    if (!availableIndicators[index] || !enabled.includes(indicator.window)) return [];
    const values = selectPriceRange(averages[index], range);
    return [{ ...indicator, values }];
  });
  const plot = pricePlot(selected, plotWidth, plotHeight, plotPadding, {
    calendar: true,
    overlays: active.map((series) => series.values),
  });
  const dateTicks = calendarDateTicks(selected);
  const change = priceChange(selected);
  const index = Math.max(
    0,
    Math.min(selected.length - 1, hovered ?? inspection ?? selected.length - 1),
  );
  const inspected = selected[index];
  const last = selected.at(-1);
  const colour =
    change === null || change === 0
      ? "var(--muted-foreground)"
      : change > 0
        ? "var(--positive)"
        : "var(--negative)";
  const values = selected.map((point) => point.close).filter(validClose);
  function inspectPointer(event: PointerEvent<SVGSVGElement>) {
    if (!plot) return;
    const box = event.currentTarget.getBoundingClientRect();
    const nearest = plot.nearestIndex((event.clientX - box.left) / box.width * plotWidth);
    if (event.pointerType === "touch") setInspection(nearest);
    else setHovered(nearest);
  }
  return (
    <section
      className="market-card price-chart"
      aria-label={`${ticker} saved price history`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker mb-1">PRICE HISTORY / MYR</p>
          <h2 className="text-xl font-semibold">The bigger picture</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved closing prices · {selected[0]?.date ?? "unavailable"} to{" "}
            {last?.date ?? "unavailable"}
          </p>
        </div>
        <div className="chart-ranges" aria-label="Price history range">
          {ranges.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => {
                setRange(item);
                setInspection(null);
                setHovered(null);
              }}
            >
              {item === "ALL" ? "All" : item}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatSharePrice(last?.close)}
        </p>
        <p
          className="text-sm font-semibold tabular-nums"
          style={{ color: colour }}
        >
          {formatPriceChange(change)}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            over selected range
          </span>
        </p>
      </div>
      {plot ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Moving averages">
            {indicators.map(({ window, colour }, i) => {
              const available = availableIndicators[i];
              return (
                <button
                  key={window}
                  type="button"
                  aria-pressed={available && enabled.includes(window)}
                  disabled={!available}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs aria-pressed:bg-muted disabled:opacity-50"
                  onClick={() => setEnabled((current) => current.includes(window)
                    ? current.filter((item) => item !== window) : [...current, window])}
                >
                  <span className="h-0.5 w-3" style={{ backgroundColor: colour }} aria-hidden="true" />
                  {window}-day average
                </button>
              );
            })}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">What do these lines show?</summary>
              <p className="mt-1">Each line averages the last 50 or 200 trading closes to smooth daily swings. A line starts only when enough saved prices are available.</p>
            </details>
          </div>
          <div className="price-plot">
          <div className="relative min-w-0">
          <svg
            className="chart-svg"
            viewBox="0 0 730 210"
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${chartId}-title ${chartId}-desc`}
            onPointerMove={inspectPointer}
            onPointerDown={inspectPointer}
            onPointerLeave={() => setHovered(null)}
          >
            <title id={`${chartId}-title`}>{`${ticker} saved closing prices in MYR`}</title>
            <desc id={`${chartId}-desc`}>
              From {selected[0]?.date} to {last?.date}. Use the price inspector
              or open the saved-price table for exact values. This is not a live
              chart.
            </desc>
            {[0, 0.5, 1].map((fraction) => {
              const value = plot.min + (plot.max - plot.min) * fraction;
              const y = plot.y(value);
              return (
                <g key={fraction}>
                  <line
                    x1="12"
                    x2="718"
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeDasharray="3 5"
                  />
                </g>
              );
            })}
            <path
              d={plot.path}
              fill="none"
              stroke={colour}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {active.map(({ window, colour }, i) => (
              <path key={window} d={plot.overlayPaths[i]} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
            {inspected && validClose(inspected.close) ? (
              <g>
                <line
                  x1={plot.x(index)}
                  x2={plot.x(index)}
                  y1="8"
                  y2="210"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="3 4"
                />
                <circle
                  cx={plot.x(index)}
                  cy={plot.y(inspected.close)}
                  r="4.5"
                  fill={colour}
                  stroke="white"
                  strokeWidth="2"
                />
              </g>
            ) : null}
          </svg>
          {(hovered !== null || inspection !== null) && inspected && validClose(inspected.close) ? (
            <div
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-card px-2 py-1 text-center text-xs shadow-sm"
              data-price-tooltip
              style={{ left: `clamp(3.5rem, ${plot.x(index) / plotWidth * 100}%, calc(100% - 3.5rem))` }}
              aria-hidden="true"
            >
              <time dateTime={inspected.date} className="block text-muted-foreground">{inspected.date}</time>
              <strong className="tabular-nums">{formatSharePrice(inspected.close)}</strong>
            </div>
          ) : null}
          </div>
          {/* HTML labels stay readable instead of shrinking with the SVG on phones. */}
          <div className="price-axis" aria-label="Price axis in MYR">
            {[0, 0.5, 1].map(fraction => {
              const value = plot.min + (plot.max - plot.min) * fraction;
              return <span key={fraction} style={{ top: `${plot.y(value) / 210 * 100}%` }}>{value.toFixed(3)}</span>;
            })}
          </div>
          </div>
          <div className="price-date-axis relative h-5 whitespace-nowrap text-[10px] text-muted-foreground sm:text-xs" aria-label="Date axis">
            {dateTicks.map((tick, i) => (
              <time
                key={tick.date}
                dateTime={tick.date}
                className={`absolute ${tick.compact ? "" : "hidden sm:block"} ${i === 0 ? "" : i === dateTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${plot.xAtFraction(tick.fraction) / plotWidth * 100}%` }}
              >{tick.label}</time>
            ))}
          </div>
          {active.some(({ values }) => values.filter((point) => validClose(point.close)).length < 2) ? (
            <p className="mt-1 text-xs text-muted-foreground">An enabled average has too few saved prices to draw in this range.</p>
          ) : null}
          <label className="chart-inspector">
            <span>Inspect a saved close</span>
            <input
              type="range"
              min="0"
              max={selected.length - 1}
              value={index}
              aria-valuetext={`${inspected?.date}: ${formatSharePrice(inspected?.close)}`}
              onChange={(event) => setInspection(Number(event.target.value))}
            />
            <span className="tabular-nums">
              {inspected?.date}{" "}
              <strong className="ml-2 text-foreground">
                {formatSharePrice(inspected?.close)}
              </strong>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <p>
              Range low{" "}
              <strong className="ml-1 font-medium text-foreground">
                {formatSharePrice(Math.min(...values))}
              </strong>
            </p>
            <p>
              Range high{" "}
              <strong className="ml-1 font-medium text-foreground">
                {formatSharePrice(Math.max(...values))}
              </strong>
            </p>
            <p>{values.length} saved closes</p>
          </div>
        </>
      ) : (
        <div className="my-6 rounded-lg bg-muted/40 px-5 py-10 text-center">
          <ChartNoAxesCombined
            className="mx-auto mb-3 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">
            Not enough saved prices for this range
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a wider range. Missing prices are not estimated.
          </p>
        </div>
      )}
      <details className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Chart details & saved-price table
        </summary>
        <p className="mt-3">
          Source: saved Yahoo daily closes, in MYR. Ranges end on the latest
          saved date, not today. Dates are spaced by calendar time;
          missing closes break the line. Unadjusted prices do not include
          dividends or adjust for corporate actions, so changes are not total
          returns.
        </p>
        <div className="mt-3 max-h-60 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">
              Saved closing prices in selected range
            </caption>
            <thead>
              <tr>
                <th scope="col" className="py-2">
                  Date
                </th>
                <th scope="col" className="text-right">
                  Close (MYR)
                </th>
              </tr>
            </thead>
            <tbody>
              {selected.map((point) => (
                <tr key={point.date} className="border-t">
                  <td className="py-1.5">{point.date}</td>
                  <td className="text-right tabular-nums">
                    {formatSharePrice(point.close)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
