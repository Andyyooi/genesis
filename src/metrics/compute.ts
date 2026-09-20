import { fundamentalMetrics } from "@/metrics/fundamentals";
import { priceMetrics } from "@/metrics/prices";
import { safeDivide } from "@/metrics/ratio";
import type { MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";

export function computeMetrics(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  periods: StatementSnapshot[];
  bars: PriceBarSnapshot[];
}): MetricValue[] {
  const fundamentals = fundamentalMetrics(args.periods, args.instrumentType);
  const prices = priceMetrics(args.bars);

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

  return [...fundamentals, ...prices, pe];
}
