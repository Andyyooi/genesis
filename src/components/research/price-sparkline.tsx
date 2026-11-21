import {
  latestPriceChange,
  pricePlot,
  type PricePoint,
} from "@/lib/price-history";

export function PriceSparkline({ points }: { points: PricePoint[] }) {
  const plot = pricePlot(points);
  if (!plot)
    return (
      <span className="text-xs text-muted-foreground">Not enough history</span>
    );
  const change = latestPriceChange(points);
  return (
    <svg
      viewBox="0 0 240 64"
      className={`price-sparkline ${change === null || change === 0 ? "move-flat" : change > 0 ? "move-up" : "move-down"}`}
      role="img"
      aria-label="Last 30 saved closing prices; open company for dates and values"
    >
      <path
        d={plot.path}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
