import { resolveScoringProfile, type ScoringProfileName } from "@/config/load-scoring";
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

function skipIndustrialReason(profile: ScoringProfileName): string | undefined {
  if (profile === "reit") {
    return "REIT: industrial FCF / EV-EBITDA / cash-leverage not applied. Inputs are not forced through this formula.";
  }
  if (profile === "bank") {
    return "Bank overlay: industrial FCF / EV-EBITDA / cash-leverage not applied. Inputs are not forced through this formula.";
  }
  return undefined;
}

export function fundamentalMetrics(
  periods: StatementSnapshot[],
  instrumentType: "COMMON_STOCK" | "REIT",
  ticker?: string | null,
  hints?: { sector?: string | null; industry?: string | null },
): MetricValue[] {
  const latest = latestAnnual(periods);
  const period = latest?.periodEnd ?? null;
  const profile = resolveScoringProfile(instrumentType, ticker, hints);
  const skipIndustrial = skipIndustrialReason(profile);

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
    shares: null,
    dividendPerShare: null,
    navPerShare: null,
    totalAssets: null,
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

  const dpuCagr = cagr(
    "dpu_cagr",
    "DPU CAGR",
    oldest?.dividendPerShare ?? null,
    newest?.dividendPerShare ?? null,
    span,
    "(latest DPU / earliest DPU)^(1/years) − 1 (DPU uses stored dividend_per_share)",
    [
      { name: "dpuStart", value: oldest?.dividendPerShare ?? null, period: oldest?.periodEnd },
      { name: "dpuEnd", value: newest?.dividendPerShare ?? null, period: newest?.periodEnd },
      { name: "years", value: span || null },
    ],
    cagrPeriod,
  );

  const bookNav = safeDivide(
    "book_nav_per_share",
    "Book NAV per share",
    row.equity ?? null,
    row.shares ?? null,
    "equity / shares (book NAV; not reported unit NAV)",
    [
      { name: "equity", value: row.equity ?? null, period: p },
      { name: "shares", value: row.shares ?? null, period: p },
    ],
    p,
    "myr",
  );

  const officialNav =
    row.navPerShare === null || !latest
      ? unavailable(
          "nav_per_share",
          "Reported NAV per unit",
          "reported NAV / unit from CSV",
          "Reported NAV per unit is not in the CSV (no nav_per_share line) — not invented",
          [{ name: "navPerShare", value: null, period: p }],
          p,
          "myr",
        )
      : {
          id: "nav_per_share",
          label: "Reported NAV per unit",
          value: row.navPerShare,
          unit: "myr" as const,
          available: true,
          reason: null,
          period: p,
          inputs: [{ name: "navPerShare", value: row.navPerShare, period: p }],
          formula: "reported NAV / unit from CSV",
        };

  const gearingInputs = [
    { name: "totalDebt", value: row.totalDebt ?? null, period: p },
    { name: "equity", value: row.equity ?? null, period: p },
    { name: "totalAssets", value: row.totalAssets ?? null, period: p },
  ];
  const reitGearing =
    row.totalDebt !== null && row.totalAssets !== null
      ? safeDivide(
          "reit_gearing",
          "REIT gearing",
          row.totalDebt,
          row.totalAssets,
          "total debt / total assets (SC-style when total_assets is stored)",
          gearingInputs,
          p,
        )
      : row.totalDebt !== null && row.equity !== null
        ? safeDivide(
            "reit_gearing",
            "REIT gearing",
            row.totalDebt,
            row.totalDebt + row.equity,
            "total debt / (total debt + equity). SC gearing vs total assets needs a total_assets line (not invented)",
            gearingInputs,
            p,
          )
        : unavailable(
            "reit_gearing",
            "REIT gearing",
            "total debt / total assets, or total debt / (total debt + equity) if total_assets is missing",
            "CSV has no total_assets line and debt or equity is missing — gearing is not invented",
            gearingInputs,
            p,
          );

  const evEbitda = unavailable(
    "ev_ebitda",
    "EV / EBITDA",
    "enterprise value / EBITDA",
    skipIndustrial ??
      "EV/EBITDA is not computed (no enterprise-value line in the CSV) — not invented",
    [{ name: "ebitda", value: row.ebitda ?? null, period: p }],
    p,
  );

  const undeclared =
    "Not in stored Yahoo/CSV filings for this name — not invented.";
  const nim = unavailable("nim", "Net interest margin", "net interest income / interest-bearing assets", undeclared, [], p);
  const costToIncome = unavailable("cost_to_income", "Cost / income", "operating expense / operating income", undeclared, [], p);
  const impairedLoans = unavailable("impaired_loans_ratio", "Impaired loans ratio", "impaired loans / gross loans", undeclared, [], p);
  const cet1 = unavailable("cet1_ratio", "CET1 ratio", "common equity tier 1 / risk-weighted assets", undeclared, [], p);
  const occupancy = unavailable("occupancy", "Occupancy", "occupied NLA / total NLA", undeclared, [], p);
  const wale = unavailable("wale_years", "WALE", "weighted average lease expiry (years)", undeclared, [], p);
  const npi = unavailable("npi", "Net property income", "reported NPI", undeclared, [], p, "myr");
  const reitIc = unavailable(
    "reit_interest_coverage",
    "REIT interest coverage",
    "NPI / finance cost",
    undeclared,
    [],
    p,
  );

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
    dpuCagr,
    bookNav,
    officialNav,
    reitGearing,
    evEbitda,
    ttmRevenueMetric,
    ttmPatMetric,
    epsMetric,
    nim,
    costToIncome,
    impairedLoans,
    cet1,
    occupancy,
    wale,
    npi,
    reitIc,
  ];
}
