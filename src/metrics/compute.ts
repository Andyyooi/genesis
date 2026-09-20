import { newsToneMetric } from "@/metrics/news";
import { fundamentalMetrics } from "@/metrics/fundamentals";
import { priceMetrics } from "@/metrics/prices";
import { available, unavailable } from "@/metrics/types";
import { safeDivide } from "@/metrics/ratio";
import type { EventSnapshot, MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";

export function computeMetrics(args: {
  instrumentType: "COMMON_STOCK" | "REIT";
  ticker?: string | null;
  sector?: string | null;
  industry?: string | null;
  periods: StatementSnapshot[];
  bars: PriceBarSnapshot[];
  events?: EventSnapshot[];
}): MetricValue[] {
  const fundamentals = fundamentalMetrics(args.periods, args.instrumentType, args.ticker, {
    sector: args.sector,
    industry: args.industry,
  });
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

  const bookNav = fundamentals.find((m) => m.id === "book_nav_per_share");
  const officialNav = fundamentals.find((m) => m.id === "nav_per_share");
  const bookNavValue = bookNav?.available ? bookNav.value : null;
  const officialNavValue = officialNav?.available ? officialNav.value : null;

  const priceToBook = safeDivide(
    "price_to_book",
    "Price / book",
    lastCloseValue,
    bookNavValue,
    "last close / book NAV (equity / shares)",
    [
      { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
      { name: "bookNavPerShare", value: bookNavValue, period: bookNav?.period },
    ],
    pePeriod,
  );

  const bookNavPremium =
    lastCloseValue === null || bookNavValue === null
      ? unavailable(
          "book_nav_premium",
          "Price vs book NAV",
          "(last close − book NAV) / book NAV",
          bookNavValue === null
            ? (bookNav?.reason ?? "Book NAV is unavailable (needs equity and shares)")
            : "Last close is unavailable",
          [
            { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
            { name: "bookNavPerShare", value: bookNavValue, period: bookNav?.period },
          ],
          pePeriod,
        )
      : bookNavValue === 0
        ? unavailable(
            "book_nav_premium",
            "Price vs book NAV",
            "(last close − book NAV) / book NAV",
            "Division by zero",
            [
              { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
              { name: "bookNavPerShare", value: bookNavValue, period: bookNav?.period },
            ],
            pePeriod,
          )
        : available(
            "book_nav_premium",
            "Price vs book NAV",
            (lastCloseValue - bookNavValue) / bookNavValue,
            "ratio",
            "(last close − book NAV) / book NAV. Positive is a premium to book. Reported unit NAV is a separate metric.",
            [
              { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
              { name: "bookNavPerShare", value: bookNavValue, period: bookNav?.period },
            ],
            pePeriod,
          );

  const navPremium =
    lastCloseValue === null || officialNavValue === null
      ? unavailable(
          "nav_premium",
          "Price vs reported NAV",
          "(last close − reported NAV) / reported NAV",
          officialNavValue === null
            ? (officialNav?.reason ?? "Reported NAV per unit is not in the CSV")
            : "Last close is unavailable",
          [
            { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
            { name: "navPerShare", value: officialNavValue, period: officialNav?.period },
          ],
          pePeriod,
        )
      : officialNavValue === 0
        ? unavailable(
            "nav_premium",
            "Price vs reported NAV",
            "(last close − reported NAV) / reported NAV",
            "Division by zero",
            [
              { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
              { name: "navPerShare", value: officialNavValue, period: officialNav?.period },
            ],
            pePeriod,
          )
        : available(
            "nav_premium",
            "Price vs reported NAV",
            (lastCloseValue - officialNavValue) / officialNavValue,
            "ratio",
            "(last close − reported NAV) / reported NAV",
            [
              { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
              { name: "navPerShare", value: officialNavValue, period: officialNav?.period },
            ],
            pePeriod,
          );

  const shares = latestAnnual?.shares ?? null;
  const marketCap =
    lastCloseValue === null || shares === null
      ? unavailable(
          "market_cap",
          "Market cap",
          "last close × shares",
          shares === null
            ? "Shares outstanding are not in the CSV — market cap is not invented"
            : "Last close is unavailable",
          [
            { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
            { name: "shares", value: shares, period: latestAnnual?.periodEnd },
          ],
          pePeriod,
          "myr",
        )
      : available(
          "market_cap",
          "Market cap",
          lastCloseValue * shares,
          "myr",
          "last close × shares",
          [
            { name: "lastClose", value: lastCloseValue, period: lastClose?.period },
            { name: "shares", value: shares, period: latestAnnual?.periodEnd },
          ],
          pePeriod,
        );

  return [
    ...fundamentals,
    ...prices,
    pe,
    dividendYield,
    priceToBook,
    bookNavPremium,
    navPremium,
    marketCap,
    news,
  ];
}
