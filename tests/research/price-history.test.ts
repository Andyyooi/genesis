import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceChart } from "@/components/research/price-chart";
import { formatMyr, formatSharePrice } from "@/lib/format-myr";
import {
  formatPriceChange,
  summariseMarketPrices,
  latestPriceChange,
  priceChange,
  pricePlot,
  selectPriceRange,
  type PricePoint,
} from "@/lib/price-history";

const point = (date: string, close: number | null): PricePoint => ({
  date,
  close,
});

describe("share-price precision", () => {
  it("keeps half-sen closes distinct without changing financial-amount formatting", () => {
    expect(formatSharePrice(0.245)).toMatch(/0\.245$/);
    expect(formatSharePrice(0.25)).toMatch(/0\.25$/);
    expect(formatSharePrice(0.245)).not.toBe(formatSharePrice(0.25));
    expect(formatSharePrice(9.87)).toBe(formatMyr(9.87));
    expect(formatMyr(0.245)).toMatch(/0\.25$/);
  });

  it("never presents missing or invalid closes as prices", () => {
    for (const close of [null, undefined, 0, -1, NaN, Infinity]) {
      expect(formatSharePrice(close)).toBe("Data unavailable");
    }
  });

  it("preserves half-sen precision in the chart inspector and exact-close table", () => {
    const html = renderToStaticMarkup(
      createElement(PriceChart, {
        ticker: "HALFSEN",
        points: [point("2026-11-19", 0.25), point("2026-11-20", 0.245)],
      }),
    );
    expect(html).toContain(
      `aria-valuetext="2026-11-20: ${formatSharePrice(0.245)}"`,
    );
    const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    expect(table).toContain(formatSharePrice(0.245));
    expect(table).toContain(formatSharePrice(0.25));
  });
});

describe("published market breadth", () => {
  it("counts the whole listed universe but only compares valid same-date pairs", () => {
    const summary = summariseMarketPrices([
      { date: "2026-11-20", close: 10, previousClose: 9 },
      { date: "2026-11-20", close: 8, previousClose: 9 },
      { date: "2026-11-20", close: 9, previousClose: 9 },
      { date: "2026-11-19", close: 10, previousClose: 9 },
      { date: "2026-11-20", close: null, previousClose: 9 },
      { date: "2026-11-20", close: 10, previousClose: 0 },
      { date: null, close: null, previousClose: null },
    ]);
    expect(summary).toEqual({
      date: "2026-11-20",
      total: 7,
      higher: 1,
      lower: 1,
      unchanged: 1,
      covered: 3,
      missing: 4,
    });
    expect(summariseMarketPrices([])).toEqual({
      date: null,
      total: 0,
      higher: 0,
      lower: 0,
      unchanged: 0,
      covered: 0,
      missing: 0,
    });
  });
});

describe("saved-price changes", () => {
  it("uses the latest two saved closes, not the chart's first observation", () => {
    const series = [
      point("2026-01-01", 4),
      point("2026-01-02", 10),
      point("2026-01-05", 11),
    ];
    expect(latestPriceChange(series)).toBeCloseTo(10);
    expect(priceChange(series)).toBeCloseTo(175);
    expect(formatPriceChange(latestPriceChange(series))).toBe("+10.00%");
  });

  it("never replaces missing, zero, or invalid endpoints with an older price", () => {
    for (const invalid of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        priceChange([point("2026-01-01", invalid), point("2026-01-02", 10)]),
      ).toBeNull();
      expect(
        latestPriceChange([
          point("2026-01-01", 8),
          point("2026-01-02", 10),
          point("2026-01-03", invalid),
        ]),
      ).toBeNull();
    }
    expect(latestPriceChange([point("2026-01-01", 10)])).toBeNull();
    expect(priceChange([])).toBeNull();
    expect(formatPriceChange(null)).toBe("Unavailable");
  });
});

describe("snapshot-anchored calendar ranges", () => {
  const series = [
    point("2024-12-31", 8),
    point("2025-02-28", 9),
    point("2025-03-01", 10),
    point("2025-03-31", 11),
  ];
  it("ends at the saved date even when the snapshot is old", () => {
    expect(selectPriceRange(series, "1M")).toEqual(series.slice(1));
    expect(selectPriceRange(series, "3M")).toEqual(series);
    expect(selectPriceRange(series, "ALL")).toEqual(series);
    expect(selectPriceRange([], "1Y")).toEqual([]);
  });
  it("clamps leap-day lookbacks to the previous February", () => {
    const leap = [
      point("2023-02-27", 1),
      point("2023-02-28", 2),
      point("2024-02-29", 3),
    ];
    expect(selectPriceRange(leap, "1Y")).toEqual(leap.slice(1));
  });
});

describe("price chart geometry", () => {
  it("draws flat prices without NaN and breaks the line at missing closes", () => {
    const plot = pricePlot([
      point("1", 10),
      point("2", 10),
      point("3", null),
      point("4", 10),
    ]);
    expect(plot?.path.match(/M/g)).toHaveLength(2);
    expect(plot?.path).not.toMatch(/NaN|Infinity/);
    expect(plot?.min).toBeLessThan(10);
    expect(plot?.max).toBeGreaterThan(10);
  });
  it("does not invent a line when fewer than two valid observations exist", () => {
    expect(pricePlot([point("1", null), point("2", 10)])).toBeNull();
    expect(pricePlot([])).toBeNull();
  });
});
