export type Holding = { ticker: string; shares: number; averagePrice: number };
export const HOLDINGS_KEY = "genesis.holdings.v1";

export function validateHolding(value: unknown): Holding {
  const h = value as Holding | null;
  if (!h || typeof h.ticker !== "string" || !h.ticker.trim() || h.ticker.length > 40 ||
    typeof h.shares !== "number" || !Number.isFinite(h.shares) || h.shares <= 0 ||
    typeof h.averagePrice !== "number" || !Number.isFinite(h.averagePrice) || h.averagePrice <= 0 ||
    !Number.isFinite(h.shares * h.averagePrice)) throw new Error("Each holding needs a ticker, positive shares and a positive average price.");
  return { ticker: h.ticker.trim().toUpperCase(), shares: h.shares, averagePrice: h.averagePrice };
}

export function mergeHolding(rows: Holding[], value: Holding): Holding[] {
  const next = validateHolding(value);
  const old = rows.find(h => h.ticker === next.ticker);
  if (!old) return [...rows, next];
  const shares = old.shares + next.shares;
  const merged = validateHolding({ ticker: next.ticker, shares, averagePrice: (old.shares * old.averagePrice + next.shares * next.averagePrice) / shares });
  return rows.map(h => h.ticker === next.ticker ? merged : h);
}

export function parseBackup(json: string): Holding[] {
  const data = JSON.parse(json);
  if (data?.version !== 1 || !Array.isArray(data.holdings) || data.holdings.length > 1000) throw new Error("Choose a Genesis holdings backup (version 1, up to 1,000 rows).");
  return data.holdings.reduce((rows: Holding[], h: unknown) => mergeHolding(rows, validateHolding(h)), []);
}

export function backupJson(holdings: Holding[]): string {
  return JSON.stringify({ version: 1, holdings }, null, 2);
}

export function holdingValue(h: Holding, price: number | null) {
  const cost = h.shares * h.averagePrice;
  const value = price !== null && Number.isFinite(price) && price >= 0 ? h.shares * price : null;
  const gain = value === null ? null : value - cost;
  return { cost, value, gain, gainPercent: gain === null ? null : gain / cost * 100 };
}

export function yearlyHoldingDividends(shares: number, annualCashPerShare: number | null) {
  if (annualCashPerShare === null) return null;
  const income = shares * annualCashPerShare;
  return Number.isFinite(income) ? income : null;
}

export function totalYearlyDividends(estimates: readonly (number | null)[]) {
  let total: number | null = null;
  let missing = 0;
  for (const estimate of estimates) {
    if (estimate === null) missing++;
    else total = (total ?? 0) + estimate;
  }
  return { total, missing };
}
