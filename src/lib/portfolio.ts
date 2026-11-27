import { z } from "zod";
import type { Holding } from "@/lib/holdings";

export const STARRED_KEY = "genesis:saved-companies:v1";
export const MAX_HOLDINGS = 1000;
export const MAX_STARS = 500;

const ticker = z.string().regex(/^[A-Z0-9._-]{1,40}$/);
const holding = z.object({ ticker, shares: z.number().positive(), averagePrice: z.number().positive() })
  .refine(h => Number.isFinite(h.shares * h.averagePrice));
const holdings = z.array(holding).max(MAX_HOLDINGS);
const starred = z.array(ticker).max(MAX_STARS);
const revision = z.number().int().nonnegative();

export const portfolioView = z.object({ revision, holdings, starred });
export type PortfolioView = z.infer<typeof portfolioView>;
export const emptyPortfolio: PortfolioView = { revision: 0, holdings: [], starred: [] };

export const portfolioEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("holdings"), holdings }),
  z.object({ kind: z.literal("starred"), starred }),
  z.object({ kind: z.literal("migrate"), holdings, starred }),
]);
export type PortfolioEdit = z.infer<typeof portfolioEdit>;
export const portfolioUpdate = z.object({ revision, edit: portfolioEdit });

export const portfolioRecord = portfolioView.extend({
  removedHoldings: z.array(ticker),
  removedStars: z.array(ticker),
});
export type PortfolioRecord = z.infer<typeof portfolioRecord>;
export const emptyRecord: PortfolioRecord = { ...emptyPortfolio, removedHoldings: [], removedStars: [] };

export function parseStars(raw: string | null): string[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Invalid saved stars");
  return [...new Set(value.filter((item): item is string => ticker.safeParse(item).success))].slice(0, MAX_STARS);
}

function uniqueHoldings(rows: Holding[]) {
  return [...new Map(rows.map(row => [row.ticker, row])).values()];
}

export function applyPortfolioEdit(current: PortfolioRecord, edit: PortfolioEdit): PortfolioRecord {
  const next = { ...current, revision: current.revision + 1 };
  if (edit.kind === "migrate") {
    const occupied = new Set([...current.removedHoldings, ...current.holdings.map(h => h.ticker)]);
    const starred = new Set([...current.removedStars, ...current.starred]);
    next.holdings = [...current.holdings, ...uniqueHoldings(edit.holdings).filter(h => !occupied.has(h.ticker))];
    next.starred = [...new Set([...current.starred, ...edit.starred.filter(t => !starred.has(t))])];
  } else if (edit.kind === "holdings") {
    next.holdings = uniqueHoldings(edit.holdings);
    const kept = new Set(next.holdings.map(h => h.ticker));
    next.removedHoldings = [...new Set([...current.removedHoldings, ...current.holdings.map(h => h.ticker)])].filter(t => !kept.has(t));
  } else {
    next.starred = [...new Set(edit.starred)];
    const kept = new Set(next.starred);
    next.removedStars = [...new Set([...current.removedStars, ...current.starred])].filter(t => !kept.has(t));
  }
  return portfolioRecord.parse(next);
}
