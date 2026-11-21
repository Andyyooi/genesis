"use client";

import { useId, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { formatMyr } from "@/lib/format-myr";
import {
  formatPriceChange,
  priceChange,
  pricePlot,
  selectPriceRange,
  validClose,
  type PricePoint,
  type PriceRange,
} from "@/lib/price-history";

const ranges: PriceRange[] = ["1M", "3M", "6M", "1Y", "ALL"];

export function PriceChart({
  ticker,
  points,
}: {
  ticker: string;
  points: PricePoint[];
}) {
  const [range, setRange] = useState<PriceRange>("3M");
  const [inspection, setInspection] = useState<number | null>(null);
  const chartId = useId();
  const selected = selectPriceRange(points, range);
  const plot = pricePlot(selected, 730, 210, 12);
  const change = priceChange(selected);
  const index = Math.max(
    0,
    Math.min(selected.length - 1, inspection ?? selected.length - 1),
  );
  const inspected = selected[index];
  const last = selected.at(-1);
  const colour =
    change === null || change === 0
      ? "#71808d"
      : change > 0
        ? "#087e60"
        : "#cf4646";
  const values = selected.map((point) => point.close).filter(validClose);
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
              }}
            >
              {item === "ALL" ? "All" : item}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatMyr(last?.close)}
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
          <svg
            className="chart-svg"
            viewBox="0 0 800 245"
            role="img"
            aria-labelledby={`${chartId}-title ${chartId}-desc`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - box.left) / box.width) * 800;
              setInspection(
                Math.max(
                  0,
                  Math.min(
                    selected.length - 1,
                    Math.round(((x - 12) / 706) * (selected.length - 1)),
                  ),
                ),
              );
            }}
          >
            <title id={`${chartId}-title`}>
              {ticker} saved closing prices in MYR
            </title>
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
                    x2="730"
                    y1={y}
                    y2={y}
                    stroke="#e7edf1"
                    strokeDasharray="3 5"
                  />
                  <text x="745" y={y + 3} fill="#7b8994" fontSize="10">
                    {value.toFixed(2)}
                  </text>
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
            {inspected && validClose(inspected.close) ? (
              <g>
                <line
                  x1={plot.x(index)}
                  x2={plot.x(index)}
                  y1="8"
                  y2="210"
                  stroke="#b6c5ce"
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
            <text x="12" y="238" fill="#7b8994" fontSize="10">
              {selected[0]?.date}
            </text>
            <text x="718" y="238" textAnchor="end" fill="#7b8994" fontSize="10">
              {last?.date}
            </text>
          </svg>
          <label className="chart-inspector">
            <span>Inspect a saved close</span>
            <input
              type="range"
              min="0"
              max={selected.length - 1}
              value={index}
              aria-valuetext={`${inspected?.date}: ${formatMyr(inspected?.close)}`}
              onChange={(event) => setInspection(Number(event.target.value))}
            />
            <span className="tabular-nums">
              {inspected?.date}{" "}
              <strong className="ml-2 text-foreground">
                {formatMyr(inspected?.close)}
              </strong>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <p>
              Range low{" "}
              <strong className="ml-1 font-medium text-foreground">
                {formatMyr(Math.min(...values))}
              </strong>
            </p>
            <p>
              Range high{" "}
              <strong className="ml-1 font-medium text-foreground">
                {formatMyr(Math.max(...values))}
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
          saved date, not today. Trading observations are equally spaced;
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
                    {formatMyr(point.close)}
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
