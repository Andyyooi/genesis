import type { LineItems } from "@/ingest/types";

const KEYS: (keyof LineItems)[] = [
  "revenue",
  "pat",
  "eps",
  "equity",
  "totalDebt",
  "cash",
  "ocf",
  "capex",
  "shares",
  "dividendPerShare",
  "navPerShare",
  "totalAssets",
];

export function emptyLineItems(): LineItems {
  return {
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
  };
}

/** Fill nulls only. Never replace a stored number, including an explicit 0. */
export function mergeLineItems(existing: LineItems, incoming: LineItems): LineItems {
  const next = { ...existing };
  for (const key of KEYS) {
    if (next[key] === null && incoming[key] !== null && incoming[key] !== undefined) {
      next[key] = incoming[key];
    }
  }
  return next;
}

export function parseLineItemsJson(raw: string | null | undefined): LineItems {
  if (!raw) return emptyLineItems();
  try {
    return { ...emptyLineItems(), ...(JSON.parse(raw) as Partial<LineItems>) };
  } catch {
    return emptyLineItems();
  }
}

export function latestAnnualHasCore(items: LineItems): boolean {
  return items.revenue !== null || items.pat !== null || items.equity !== null;
}

export function latestAnnualIsFull(items: LineItems): boolean {
  return items.revenue !== null && items.pat !== null && items.equity !== null;
}
