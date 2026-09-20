import { newsToneMetric } from "@/metrics/news";
import { fundamentalMetrics } from "@/metrics/fundamentals";
import { priceMetrics } from "@/metrics/prices";
import { safeDivide } from "@/metrics/ratio";
import type { EventSnapshot, MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";

export function computeMetrics(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  periods: StatementSnapshot[];
  bars: PriceBarSnapshot[];
  events?: EventSnapshot[];
}): MetricValue[] {
  const fundamentals = fundamentalMetrics(args.periods, args.instrumentType);
  const prices = priceMetrics(args.bars);
  const news = newsToneMetric(args.events ?? []);

  const latestAnnual = [...args.periods]
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const lastClose = prices.find((m) => m.id === "last_close");
  const pePeriod =
    lastClose?.period && latestAnnual
      ? `${latestAnnual.periodEnd} vs ${lastClose.period}`
      : (lastClose?.period ?? latestAnnual?.periodEnd ?? null);
  const eps = latestAnnual?.eps ?? null;
  let peReason: string | undefined;
  let peDenominator: number | null = eps;
  if (eps !== null && eps <= 0) {
    peReason = "EPS is zero or negative — P/E is unavailable (not 0)";
    peDenominator = null;
  }

  const pe = safeDivide(
    "price_to_earnings",
    "Price / EPS",
    lastClose?.available ? lastClose.value : null,
    peDenominator,
    "last close / latest annual EPS",
    [
      { name: "lastClose", value: lastClose?.value ?? null, period: lastClose?.period },
      { name: "eps", value: eps, period: latestAnnual?.periodEnd },
    ],
    pePeriod,
    "ratio",
    peReason,
  );

  const dps = latestAnnual?.dividendPerShare ?? null;
  const lastCloseValue = lastClose?.available ? lastClose.value : null;
  const dividendYield = safeDivide(
    "dividend_yield",
    "Dividend yield",
    dps,
    lastCloseValue !== null && lastCloseValue > 0 ? lastCloseValue : lastCloseValue === 0 ? 0 : null,
    "latest annual DPS / last close",
    [
      { name: "dividendPerShare", value: dps, period: latestAnnual?.periodEnd },
      { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
    ],
    pePeriod,
  );

  return [...fundamentals, ...prices, pe, dividendYield, news];
}
