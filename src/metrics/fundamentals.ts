import { cagr } from "@/metrics/cagr";
import { safeDivide } from "@/metrics/ratio";
import { unavailable, type MetricValue, type StatementSnapshot } from "@/metrics/types";

function latestAnnual(periods: StatementSnapshot[]): StatementSnapshot | null {
  const annual = periods
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return annual[0] ?? null;
}

function annualSortedAsc(periods: StatementSnapshot[]): StatementSnapshot[] {
  return periods
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

function yearSpan(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}

const INDUSTRIAL_ONLY = new Set([
  "fcf",
  "net_debt",
  "net_debt_to_ebitda",
  "interest_coverage",
  "debt_to_equity",
]);

export function fundamentalMetrics(
  periods: StatementSnapshot[],
  instrumentType: "COMMON_STOCK" | "REIT",
): MetricValue[] {
  const latest = latestAnnual(periods);
  const period = latest?.periodEnd ?? null;
  const skipIndustrial =
    instrumentType === "REIT"
      ? "REIT: industrial metric not applied (REIT factor set is later). Inputs are not forced through this formula."
      : undefined;

  const row = latest ?? {
    periodEnd: "",
    fiscalQuarter: null,
    revenue: null,
    pat: null,
    eps: null,
    equity: null,
    totalDebt: null,
    cash: null,
    ocf: null,
    capex: null,
    grossProfit: null,
    operatingProfit: null,
    ebitda: null,
    ebit: null,
    interestExpense: null,
  };

  const p = period;

  const grossMargin = safeDivide(
    "gross_margin",
    "Gross margin",
    row.grossProfit,
    row.revenue,
    "gross profit / revenue",
    [
      { name: "grossProfit", value: row.grossProfit ?? null, period: p },
      { name: "revenue", value: row.revenue ?? null, period: p },
    ],
    p,
  );

  const operatingMargin = safeDivide(
    "operating_margin",
    "Operating margin",
    row.operatingProfit,
    row.revenue,
    "operating profit / revenue",
    [
      { name: "operatingProfit", value: row.operatingProfit ?? null, period: p },
      { name: "revenue", value: row.revenue ?? null, period: p },
    ],
    p,
  );

  const netMargin = safeDivide(
    "net_margin",
    "Net margin",
    row.pat,
    row.revenue,
    "PAT / revenue",
    [
      { name: "pat", value: row.pat ?? null, period: p },
      { name: "revenue", value: row.revenue ?? null, period: p },
    ],
    p,
  );

  const roe = safeDivide(
    "roe",
    "ROE",
    row.pat,
    row.equity,
    "PAT / equity",
    [
      { name: "pat", value: row.pat ?? null, period: p },
      { name: "equity", value: row.equity ?? null, period: p },
    ],
    p,
  );

  const debtToEquity = safeDivide(
    "debt_to_equity",
    "Debt / equity",
    row.totalDebt,
    row.equity,
    "total debt / equity",
    [
      { name: "totalDebt", value: row.totalDebt ?? null, period: p },
      { name: "equity", value: row.equity ?? null, period: p },
    ],
    p,
    "ratio",
    skipIndustrial && INDUSTRIAL_ONLY.has("debt_to_equity") ? skipIndustrial : undefined,
  );

  const netDebtInputs = [
    { name: "totalDebt", value: row.totalDebt ?? null, period: p },
    { name: "cash", value: row.cash ?? null, period: p },
  ];
  const netDebt =
    skipIndustrial && INDUSTRIAL_ONLY.has("net_debt")
      ? unavailable("net_debt", "Net debt", "total debt − cash", skipIndustrial, netDebtInputs, p, "myr")
      : row.totalDebt === null || row.cash === null
        ? unavailable(
            "net_debt",
            "Net debt",
            "total debt − cash",
            "total debt and cash are both required (missing cash is not treated as zero)",
            netDebtInputs,
            p,
            "myr",
          )
        : {
            id: "net_debt",
            label: "Net debt",
            value: row.totalDebt - row.cash,
            unit: "myr" as const,
            available: true,
            reason: null,
            period: p,
            inputs: netDebtInputs,
            formula: "total debt − cash",
          };

  const netDebtToEbitda = safeDivide(
    "net_debt_to_ebitda",
    "Net debt / EBITDA",
    netDebt.available ? netDebt.value : null,
    row.ebitda ?? null,
    "(total debt − cash) / EBITDA",
    [...netDebtInputs, { name: "ebitda", value: row.ebitda ?? null, period: p }],
    p,
    "ratio",
    skipIndustrial,
  );

  const interestCoverage = safeDivide(
    "interest_coverage",
    "Interest coverage",
    row.ebit ?? null,
    row.interestExpense ?? null,
    "EBIT / interest expense",
    [
      { name: "ebit", value: row.ebit ?? null, period: p },
      { name: "interestExpense", value: row.interestExpense ?? null, period: p },
    ],
    p,
    "ratio",
    skipIndustrial,
  );

  const fcfInputs = [
    { name: "ocf", value: row.ocf ?? null, period: p },
    { name: "capex", value: row.capex ?? null, period: p },
  ];
  const fcf =
    skipIndustrial && INDUSTRIAL_ONLY.has("fcf")
      ? unavailable("fcf", "Free cash flow", "OCF − capex", skipIndustrial, fcfInputs, p, "myr")
      : row.ocf === null || row.capex === null
        ? unavailable(
            "fcf",
            "Free cash flow",
            "OCF − capex",
            "OCF and capex are both required (missing capex is not treated as zero)",
            fcfInputs,
            p,
            "myr",
          )
        : {
            id: "fcf",
            label: "Free cash flow",
            value: row.ocf - row.capex,
            unit: "myr" as const,
            available: true,
            reason: null,
            period: p,
            inputs: fcfInputs,
            formula: "OCF − capex (capex as positive cash spent)",
          };

  const annual = annualSortedAsc(periods);
  const oldest = annual[0];
  const newest = annual[annual.length - 1];
  const span = oldest && newest ? yearSpan(oldest.periodEnd, newest.periodEnd) : 0;
  const cagrPeriod =
    oldest && newest ? `${oldest.periodEnd} → ${newest.periodEnd}` : p;

  const revenueCagr = cagr(
    "revenue_cagr",
    "Revenue CAGR",
    oldest?.revenue ?? null,
    newest?.revenue ?? null,
    span,
    "(latest revenue / earliest revenue)^(1/years) − 1",
    [
      { name: "revenueStart", value: oldest?.revenue ?? null, period: oldest?.periodEnd },
      { name: "revenueEnd", value: newest?.revenue ?? null, period: newest?.periodEnd },
      { name: "years", value: span || null },
    ],
    cagrPeriod,
  );

  const patCagr = cagr(
    "pat_cagr",
    "PAT CAGR",
    oldest?.pat ?? null,
    newest?.pat ?? null,
    span,
    "(latest PAT / earliest PAT)^(1/years) − 1",
    [
      { name: "patStart", value: oldest?.pat ?? null, period: oldest?.periodEnd },
      { name: "patEnd", value: newest?.pat ?? null, period: newest?.periodEnd },
      { name: "years", value: span || null },
    ],
    cagrPeriod,
  );

  const quarters = periods
    .filter((row) => row.statementType === "interim" && row.fiscalQuarter != null)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const ttmFour = quarters.slice(0, 4);
  const ttmPeriod =
    ttmFour.length === 4 ? `${ttmFour[3]!.periodEnd} → ${ttmFour[0]!.periodEnd}` : null;
  const ttmRevenue =
    ttmFour.length === 4 && ttmFour.every((q) => q.revenue !== null)
      ? ttmFour.reduce((sum, q) => sum + (q.revenue as number), 0)
      : null;
  const ttmPat =
    ttmFour.length === 4 && ttmFour.every((q) => q.pat !== null)
      ? ttmFour.reduce((sum, q) => sum + (q.pat as number), 0)
      : null;

  const ttmRevenueMetric =
    ttmRevenue === null
      ? unavailable(
          "ttm_revenue",
          "TTM revenue",
          "sum of last four quarterly revenue figures",
          "TTM needs four quarterly periods with revenue (annual-only history is not treated as TTM)",
          [],
          ttmPeriod,
          "myr",
        )
      : {
          id: "ttm_revenue",
          label: "TTM revenue",
          value: ttmRevenue,
          unit: "myr" as const,
          available: true,
          reason: null,
          period: ttmPeriod,
          inputs: ttmFour.map((q) => ({
            name: `revenue ${q.periodEnd}`,
            value: q.revenue,
            period: q.periodEnd,
          })),
          formula: "sum of last four quarterly revenue figures",
        };

  const ttmPatMetric =
    ttmPat === null
      ? unavailable(
          "ttm_pat",
          "TTM PAT",
          "sum of last four quarterly PAT figures",
          "TTM needs four quarterly periods with PAT (annual-only history is not treated as TTM)",
          [],
          ttmPeriod,
          "myr",
        )
      : {
          id: "ttm_pat",
          label: "TTM PAT",
          value: ttmPat,
          unit: "myr" as const,
          available: true,
          reason: null,
          period: ttmPeriod,
          inputs: ttmFour.map((q) => ({
            name: `pat ${q.periodEnd}`,
            value: q.pat,
            period: q.periodEnd,
          })),
          formula: "sum of last four quarterly PAT figures",
        };

  const epsMetric =
    row.eps === null || !latest
      ? unavailable(
          "eps",
          "EPS",
          "reported EPS",
          "EPS is unavailable",
          [{ name: "eps", value: null, period: p }],
          p,
        )
      : {
          id: "eps",
          label: "EPS",
          value: row.eps,
          unit: "myr" as const,
          available: true,
          reason: null,
          period: p,
          inputs: [{ name: "eps", value: row.eps, period: p }],
          formula: "reported EPS (negative EPS is kept; not coerced to zero)",
        };

  return [
    grossMargin,
    operatingMargin,
    netMargin,
    roe,
    debtToEquity,
    netDebt,
    netDebtToEbitda,
    interestCoverage,
    fcf,
    revenueCagr,
    patCagr,
    ttmRevenueMetric,
    ttmPatMetric,
    epsMetric,
  ];
}
