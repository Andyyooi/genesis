import type { ScoreResult } from "@/scoring/types";

export const LIST_IDS = [
  "watchlist",
  "undervalued",
  "quality",
  "quality-value",
  "improving",
  "discounted",
  "catalyst",
] as const;

export type ListId = (typeof LIST_IDS)[number];

export type OpportunityList = {
  id: ListId;
  label: string;
  description: string;
  /** Empty until a later phase supplies the inputs. */
  disabled: boolean;
  disabledReason?: string;
};

export const OPPORTUNITY_LISTS: OpportunityList[] = [
  {
    id: "watchlist",
    label: "Watchlist",
    description: "Every name in universe.yaml. These are research lists, not buy orders.",
    disabled: false,
  },
  {
    id: "undervalued",
    label: "Potentially Undervalued",
    description: "Valuation Score at least 70/100 (valuation factors only).",
    disabled: false,
  },
  {
    id: "quality",
    label: "High Quality",
    description: "Business Quality category at least 70/100.",
    disabled: false,
  },
  {
    id: "quality-value",
    label: "Quality + Value",
    description: "Quality and Valuation both at least 70/100.",
    disabled: false,
  },
  {
    id: "improving",
    label: "Improving",
    description:
      "Latest persisted Research Score is higher than the previous score_run. Needs at least two stored runs.",
    disabled: false,
  },
  {
    id: "discounted",
    label: "Recently Discounted",
    description:
      "At least 15% below the stored 52-week high, with Quality still at least 50/100. Skipped if 52-week history is unavailable.",
    disabled: false,
  },
  {
    id: "catalyst",
    label: "Catalyst Watch",
    description:
      "Names with a stored Positive catalyst, Negative, or Uncertain announcement. Research list, not a buy list.",
    disabled: false,
  },
];

export type OpportunityRow = {
  ticker: string;
  name: string;
  instrumentType: "COMMON_STOCK" | "REIT";
  pn17: boolean;
  price: number | null;
  lastTradeDate: string | null;
  fundamentalsPeriod: string | null;
  researchScore: number | null;
  valuationScore: number | null;
  qualityScore: number | null;
  growthScore: number | null;
  healthScore: number | null;
  coverage: number | null;
  mainConcern: string | null;
  distanceFrom52wHigh: number | null;
  distanceFrom52wHighAvailable: boolean;
  /** Newest persisted research scores first. Live run is not prepended. */
  persistedResearchScores: (number | null)[];
  catalystWatch: boolean;
  catalystLabel: string | null;
  result: ScoreResult;
};

export function parseListId(value: string | undefined): ListId {
  if (value && (LIST_IDS as readonly string[]).includes(value)) return value as ListId;
  return "watchlist";
}

export function categoryScore(result: ScoreResult, id: string): number | null {
  return result.categories.find((c) => c.id === id)?.score ?? null;
}

/** Mean factor coverage of categories that can be in a live run (technical still excluded). */
export function liveCoverage(result: ScoreResult): number | null {
  const liveSlots = result.categories.filter((c) => c.id !== "technical");
  if (liveSlots.length === 0) return null;
  return liveSlots.reduce((sum, c) => sum + c.coverage, 0) / liveSlots.length;
}

export function mainConcernLabel(result: ScoreResult): string | null {
  const hit = result.concerns[0];
  return hit ? hit.label : null;
}

export function researchListIds(
  row: Pick<
    OpportunityRow,
    | "valuationScore"
    | "qualityScore"
    | "persistedResearchScores"
    | "distanceFrom52wHigh"
    | "distanceFrom52wHighAvailable"
    | "catalystWatch"
  >,
): ListId[] {
  const full = row as OpportunityRow;
  return LIST_IDS.filter((id) => id !== "watchlist" && rowMatchesList(full, id));
}

export function rowMatchesList(row: OpportunityRow, list: ListId): boolean {
  if (list === "watchlist") return true;
  if (list === "catalyst") return row.catalystWatch;
  if (list === "undervalued") return (row.valuationScore ?? -1) >= 70;
  if (list === "quality") return (row.qualityScore ?? -1) >= 70;
  if (list === "quality-value") {
    return (row.qualityScore ?? -1) >= 70 && (row.valuationScore ?? -1) >= 70;
  }
  if (list === "improving") {
    if (row.persistedResearchScores.length < 2) return false;
    const latest = row.persistedResearchScores[0];
    const previous = row.persistedResearchScores[1];
    if (latest === null || previous === null) return false;
    return latest > previous + 0.5;
  }
  if (list === "discounted") {
    if (!row.distanceFrom52wHighAvailable || row.distanceFrom52wHigh === null) return false;
    if ((row.qualityScore ?? -1) < 50) return false;
    return row.distanceFrom52wHigh >= 0.15;
  }
  return false;
}
