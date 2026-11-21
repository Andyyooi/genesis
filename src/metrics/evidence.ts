import type { ScoringConfig } from "@/config/load-scoring";
import { available, unavailable, type MetricValue, type PriceBarSnapshot, type StatementSnapshot } from "@/metrics/types";

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
const divide = (a: number | null | undefined, b: number | null | undefined): number | null =>
  finite(a) && finite(b) && b > 0 ? a / b : null;

export function accountsUsableFrom(row: { periodEnd: string; availableAt: string | null }, lagMonths: number): string | null {
  if (row.availableAt) return Number.isFinite(Date.parse(row.availableAt)) ? row.availableAt : null;
  const date = new Date(`${row.periodEnd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + lagMonths);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function usableAccounts<T extends { periodEnd: string; availableAt: string | null; actualOrEstimate?: string }>(rows: T[], asOf: string, lagMonths: number): T[] {
  const timestamp = Date.parse(asOf);
  return rows.filter((row) => {
    const from = accountsUsableFrom(row, lagMonths);
    return row.actualOrEstimate !== "estimate" && from !== null && Date.parse(from) <= timestamp;
  });
}

export function annualAccounts(periods: StatementSnapshot[]): StatementSnapshot[] {
  const byEnd = new Map<string, StatementSnapshot>();
  const sorted = periods.filter((p) => p.statementType === "annual").sort((a, b) =>
    Number(a.source.startsWith("yahoo")) - Number(b.source.startsWith("yahoo")) || a.source.localeCompare(b.source),
  );
  for (const row of sorted) {
    const existing = byEnd.get(row.periodEnd);
    if (!existing) byEnd.set(row.periodEnd, { ...row });
    else {
      for (const key of Object.keys(row) as (keyof StatementSnapshot)[]) {
        if (existing[key] == null && finite(row[key] as number | null)) Object.assign(existing, { [key]: row[key] });
      }
    }
  }
  return [...byEnd.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export function dailyPriceBars(bars: PriceBarSnapshot[], asOf = new Date().toISOString()): PriceBarSnapshot[] {
  const byDay = new Map<string, PriceBarSnapshot>();
  for (const bar of bars) {
    if (bar.barDate <= asOf.slice(0, 10) && !byDay.has(bar.barDate)) byDay.set(bar.barDate, bar);
  }
  return [...byDay.values()].sort((a, b) => a.barDate.localeCompare(b.barDate));
}

export function priceEvidence(bars: PriceBarSnapshot[], asOf?: string): MetricValue[] {
  const window = dailyPriceBars(bars, asOf).slice(-253);
  const full = window.length === 253;
  const adjusted = full && window.every((b) => finite(b.adjClose) && b.adjClose > 0);
  const prices = window.map((b) => adjusted ? b.adjClose! : b.close);
  const valid = full && prices.every((p) => finite(p) && p > 0);
  const period = window.length ? `${window[0].barDate} to ${window[window.length - 1].barDate}` : null;
  const kind = adjusted ? "adjusted closes (includes provider dividend/split adjustments)" : "raw closes (dividends not included)";
  const momentum = valid ? prices[231]! / prices[0]! - 1 : null;
  let volatility: number | null = null;
  if (valid) {
    const returns = prices.slice(1).map((p, i) => p! / prices[i]! - 1);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    volatility = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
  }
  return [
    metric("momentum_12_1", momentum, `close(t−21) / close(t−252) − 1; ${kind}`, period, [
      { name: "startPrice", value: prices[0] ?? null, period: window[0]?.barDate },
      { name: "endPrice", value: prices[231] ?? null, period: window[231]?.barDate },
    ], "253 distinct stored sessions with positive prices are required"),
    metric("volatility_252", volatility, `sample std dev of 252 daily returns × √252; ${kind}`, period, [], "253 distinct stored sessions with positive prices are required"),
  ];
}

export type PiotroskiResult = { points: number; computable: number; scaled: number | null; components: { name: string; value: number | null }[] };

export function piotroski(current: StatementSnapshot | undefined, prior: StatementSnapshot | undefined): PiotroskiResult {
  const c = current;
  const p = prior;
  const roa = divide(c?.pat, c?.totalAssets);
  const previousRoa = divide(p?.pat, p?.totalAssets);
  const leverage = divide(c?.longTermDebt, c?.totalAssets);
  const previousLeverage = divide(p?.longTermDebt, p?.totalAssets);
  const liquidity = divide(c?.currentAssets, c?.currentLiabilities);
  const previousLiquidity = divide(p?.currentAssets, p?.currentLiabilities);
  const margin = divide(c?.grossProfit, c?.revenue);
  const previousMargin = divide(p?.grossProfit, p?.revenue);
  const turnover = divide(c?.revenue, c?.totalAssets);
  const previousTurnover = divide(p?.revenue, p?.totalAssets);
  const comparison = (a: number | null | undefined, b: number | null | undefined, test: (x: number, y: number) => boolean) =>
    finite(a) && finite(b) ? Number(test(a, b)) : null;
  const components = [
    { name: "Positive ROA (PAT / year-end assets)", value: comparison(roa, 0, (a, b) => a > b) },
    { name: "Positive operating cash flow", value: comparison(c?.ocf, 0, (a, b) => a > b) },
    { name: "ROA improved", value: comparison(roa, previousRoa, (a, b) => a > b) },
    { name: "Operating cash flow exceeds PAT", value: comparison(c?.ocf, c?.pat, (a, b) => a > b) },
    { name: "Long-term debt / assets decreased", value: comparison(leverage, previousLeverage, (a, b) => a < b) },
    { name: "Current ratio improved", value: comparison(liquidity, previousLiquidity, (a, b) => a > b) },
    { name: "No share dilution", value: comparison(c?.shares, p?.shares, (a, b) => a <= b) },
    { name: "Gross margin improved", value: comparison(margin, previousMargin, (a, b) => a > b) },
    { name: "Asset turnover improved", value: comparison(turnover, previousTurnover, (a, b) => a > b) },
  ];
  const computable = components.filter((item) => item.value !== null).length;
  const points = components.reduce((sum, item) => sum + (item.value ?? 0), 0);
  return { points, computable, scaled: computable >= 6 ? points / computable * 9 : null, components };
}

function metric(id: string, value: number | null, formula: string, period: string | null, inputs: MetricValue["inputs"] = [], reason = "Required usable annual inputs are missing or denominator is not positive"): MetricValue {
  return finite(value)
    ? available(id, id.replaceAll("_", " "), value, "ratio", formula, inputs, period)
    : unavailable(id, id.replaceAll("_", " "), formula, reason, inputs, period);
}

export function evidenceMetrics(periods: StatementSnapshot[], bars: PriceBarSnapshot[], config: ScoringConfig, asOf: string): MetricValue[] {
  const annuals = annualAccounts(usableAccounts(periods, asOf, config.reporting_lag_months));
  const current = annuals[0];
  const period = current?.periodEnd ?? null;
  const endpoint = (years: number) => current ? annuals.find((row) =>
    Number(row.periodEnd.slice(0, 4)) === Number(current.periodEnd.slice(0, 4)) - years &&
    row.periodEnd.slice(5, 7) === current.periodEnd.slice(5, 7) &&
    Math.abs(Number(row.periodEnd.slice(8, 10)) - Number(current.periodEnd.slice(8, 10))) <= 1,
  ) : undefined;
  const previous = endpoint(1);
  const start = endpoint(config.growth_years);
  const close = dailyPriceBars(bars, asOf).at(-1)?.close;
  const cap = finite(close) && close > 0 && finite(current?.shares) && current.shares > 0 ? close * current.shares : null;
  const ev = cap !== null && finite(current?.totalDebt) && finite(current?.cash) ? cap + current.totalDebt - current.cash : null;
  const nav = finite(current?.navPerShare) ? current.navPerShare : divide(current?.equity, current?.shares);
  const f = piotroski(current, previous);
  const window = annuals.filter((row) => current && Number(row.periodEnd.slice(0, 4)) >= Number(current.periodEnd.slice(0, 4)) - config.growth_years);
  const definitionBreak = window.some((row, i) => {
    const prior = window[i + 1];
    if (!prior || Number(row.periodEnd.slice(0, 4)) - Number(prior.periodEnd.slice(0, 4)) !== 1) return false;
    const revenueRatio = divide(row.revenue, prior.revenue);
    const stablePAT = finite(row.pat) && finite(prior.pat) && prior.pat !== 0 && Math.abs(row.pat - prior.pat) / Math.abs(prior.pat) <= config.consistency.pat_stability_tolerance;
    return revenueRatio !== null && (revenueRatio < config.consistency.revenue_break_ratio || revenueRatio > 1 / config.consistency.revenue_break_ratio) && stablePAT;
  });
  const epsConsistent = (row: StatementSnapshot | undefined) => {
    const implied = divide(row?.pat, row?.shares);
    if (!finite(implied) || !finite(row?.eps)) return true;
    if (Math.sign(implied) !== Math.sign(row.eps)) return false;
    return implied === 0 || Math.max(Math.abs(row.eps / implied), Math.abs(implied / row.eps)) <= config.consistency.eps_scale_tolerance;
  };
  const ratio = (id: string, a: number | null | undefined, b: number | null | undefined, formula: string) =>
    metric(id, divide(a, b), formula, period, [{ name: "numerator", value: a ?? null }, { name: "denominator", value: b ?? null }]);
  const growth = (id: string, key: "revenue" | "eps" | "dividendPerShare") => {
    if (key === "revenue" && definitionBreak) return unavailable(id, "Revenue CAGR", "fixed-window annual revenue CAGR", "Possible revenue definition break: revenue changed by more than the configured threshold while PAT stayed stable. Growth and falling-revenue flags are withheld for this window.", [], period);
    if (key === "eps" && (!epsConsistent(current) || !epsConsistent(start))) return unavailable(id, "EPS CAGR", "fixed-window annual EPS CAGR", "Reported EPS sign/scale conflicts with PAT / shares at a growth endpoint.", [], period);
    const a = start?.[key];
    const b = current?.[key];
    const value = finite(a) && a > 0 && finite(b) && b >= 0 ? (b / a) ** (1 / config.growth_years) - 1 : null;
    return metric(id, value, `(latest ${key} / ${key} exactly ${config.growth_years} fiscal years earlier)^(1/${config.growth_years}) − 1`, period, [
      { name: `${key}Start`, value: a ?? null, period: start?.periodEnd },
      { name: `${key}End`, value: b ?? null, period: current?.periodEnd },
    ], "Both fixed-window annual endpoints are required, with a positive start and nonnegative end");
  };
  return [
    ratio("earnings_yield", current?.pat, cap, "annual PAT / (current price × shares); reported EPS is not substituted"),
    metric("price_to_earnings", finite(current?.pat) && current.pat > 0 ? divide(cap, current.pat) : null, "market cap / positive annual PAT", period, [{ name: "marketCap", value: cap }, { name: "PAT", value: current?.pat ?? null }], "P/E is unavailable for zero or negative PAT or missing PAT / market cap"),
    ratio("book_to_price", divide(current?.equity, current?.shares), close, "(equity / shares) / current price"),
    metric("enterprise_value", ev, "current price × shares + total debt − cash (all inputs required)", period, [
      { name: "marketCap", value: cap }, { name: "totalDebt", value: current?.totalDebt ?? null }, { name: "cash", value: current?.cash ?? null },
    ]),
    ratio("ebit_ev", current?.ebit, ev, "annual EBIT (or operating income) / (market cap + debt − cash)"),
    ratio("gross_profitability", current?.grossProfit, current?.totalAssets, "annual gross profit / year-end total assets"),
    ratio("roe", current?.pat, current?.equity, "annual PAT / positive book equity"),
    ratio("debt_to_equity", current?.totalDebt, current?.equity, "total debt / positive book equity"),
    ratio("nav_to_price", nav, close, "reported NAV / price; book equity per share if reported NAV is absent"),
    metric("piotroski", f.scaled, `Piotroski: ${f.points} passed / ${f.computable} computable × 9; minimum 6 of 9; year-end assets convention`, period, f.components, "Fewer than 6 of 9 Piotroski components computable from consecutive usable annuals"),
    metric("piotroski_computable", f.computable, "Number of available Piotroski checks out of nine", period),
    metric("piotroski_points", f.points, "Passed Piotroski checks (not scaled)", period),
    growth("revenue_cagr", "revenue"), growth("eps_cagr", "eps"), growth("dpu_cagr", "dividendPerShare"),
    ...priceEvidence(bars, asOf),
  ];
}
