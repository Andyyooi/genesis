import { isFiniteNumber } from "@/lib/display";
import type { ListFairRange } from "@/lib/fair-range-summary";
import type { ScoreResult } from "@/scoring/types";
import type { WatchlistReason } from "@/opportunities/watchlist-selection";

export const LIST_IDS = [
  "watchlist",
  "undervalued",
  "buy-score",
  "quality-value",
  "at-or-below-fair-range",
  "discounted",
] as const;

export type ListId = (typeof LIST_IDS)[number];

export type OpportunityList = {
  id: ListId;
  label: string;
  description: string;
  /** Empty until a later phase supplies the inputs. */
  disabled: boolean;
  disabledReason?: string;
  showWhenEmpty?: boolean;
};

export const OPPORTUNITY_LISTS: OpportunityList[] = [
  {
    id: "watchlist",
    label: "Watchlist",
    description: "A market shortlist updated with each data refresh. Use stars to make your own shortlist. These are research lists, not buy orders.",
    disabled: false,
  },
  {
    id: "undervalued",
    label: "Potentially Undervalued",
    description: "Valuation Score at least 70/100 (valuation factors only).",
    disabled: false,
  },
  {
    id: "buy-score",
    label: "Buy rank above 90",
    description: "Research score ranks ahead of more than 90% of all stocks and passes the safety checks. A rank, not a buy signal: check the price against the fair range.",
    disabled: false,
    showWhenEmpty: true,
  },
  {
    id: "quality-value",
    label: "Quality + Value",
    description: "Quality and Valuation both at least 70/100.",
    disabled: false,
  },
  {
    id: "at-or-below-fair-range",
    label: "At or below fair range",
    description: "Saved share price within or below the fair range. Requires both a price and a fair range.",
    disabled: false,
    showWhenEmpty: true,
  },
  {
    id: "discounted",
    label: "Recently Discounted",
    description:
      "At least 15% below the stored 52-week high, with Quality still at least 50/100. Skipped if 52-week history is unavailable.",
    disabled: false,
  },
];

export type OpportunityRow = {
  ticker: string;
  watchlistReason?: WatchlistReason | null;
  name: string;
  instrumentType: "COMMON_STOCK" | "REIT";
  pn17: boolean;
  shariahCompliant: boolean | null;
  listingBoard: string | null;
  marketCap: number | null;
  sector: string | null;
  researchProfile: string;
  price: number | null;
  buyScore: number | null;
  lastTradeDate: string | null;
  fundamentalsPeriod: string | null;
  researchScore: number | null;
  valuationScore: number | null;
  qualityScore: number | null;
  growthScore: number | null;
  healthScore: number | null;
  coverage: number | null;
  /** Core coverage ratio from dataCoverage (0–1). */
  coreCoverageRatio: number | null;
  freshness: string | null;
  confidence: string | null;
  needsVerification: boolean;
  coreCoverageLabel: string | null;
  mainConcern: string | null;
  distanceFrom52wHigh: number | null;
  distanceFrom52wHighAvailable: boolean;
  catalystWatch: boolean;
  catalystLabel: string | null;
  hasEvents: boolean;
  eventCount: number;
  result: ScoreResult;
};

export type DashboardSortId =
  | "ticker"
  | "research"
  | "valuation"
  | "confidence"
  | "coverage"
  | "freshness"
  | "profile"
  | "sector";

export const DASHBOARD_SORT_IDS: DashboardSortId[] = [
  "ticker",
  "research",
  "valuation",
  "confidence",
  "coverage",
  "freshness",
  "profile",
  "sector",
];

export type DashboardFlagFilter = {
  instrumentType?: "COMMON_STOCK" | "REIT";
  shariah?: boolean;
  board?: string;
  cap?: "large" | "mid" | "small";
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
  freshness?: string;
  profile?: string;
};

/** Cap buckets in MYR. Not a scored factor. Missing market cap is excluded when a cap filter is on. */
export function capBucket(marketCapMyr: number): "large" | "mid" | "small" {
  if (marketCapMyr >= 10_000_000_000) return "large";
  if (marketCapMyr >= 2_000_000_000) return "mid";
  return "small";
}

export function parseDashboardFilters(params: {
  type?: string;
  shariah?: string;
  board?: string;
  cap?: string;
  confidence?: string;
  freshness?: string;
  profile?: string;
}): DashboardFlagFilter {
  const filters: DashboardFlagFilter = {};
  if (params.type === "REIT" || params.type === "COMMON_STOCK") filters.instrumentType = params.type;
  if (params.shariah === "yes") filters.shariah = true;
  if (params.board && params.board.trim()) filters.board = params.board.trim().toUpperCase();
  if (params.cap === "large" || params.cap === "mid" || params.cap === "small") filters.cap = params.cap;
  if (
    params.confidence === "HIGH" ||
    params.confidence === "MEDIUM" ||
    params.confidence === "LOW" ||
    params.confidence === "VERY_LOW"
  ) {
    filters.confidence = params.confidence;
  }
  if (params.freshness && params.freshness.trim()) filters.freshness = params.freshness.trim().toUpperCase();
  if (params.profile && params.profile.trim()) filters.profile = params.profile.trim().toUpperCase();
  return filters;
}

export function parseDashboardSort(value: string | undefined): DashboardSortId {
  if (value && (DASHBOARD_SORT_IDS as readonly string[]).includes(value)) {
    return value as DashboardSortId;
  }
  return "ticker";
}

const CONFIDENCE_RANK: Record<string, number> = {
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  VERY_LOW: 1,
};

const FRESHNESS_RANK: Record<string, number> = {
  FRESH: 4,
  AGING: 3,
  STALE: 2,
  VERY_STALE: 1,
  UNKNOWN: 0,
};

function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortOpportunityRows(rows: OpportunityRow[], sort: DashboardSortId): OpportunityRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sort) {
      case "research":
        return nullsLast(a.researchScore, b.researchScore) || a.ticker.localeCompare(b.ticker);
      case "valuation":
        return nullsLast(a.valuationScore, b.valuationScore) || a.ticker.localeCompare(b.ticker);
      case "confidence": {
        const diff =
          (CONFIDENCE_RANK[b.confidence ?? ""] ?? 0) - (CONFIDENCE_RANK[a.confidence ?? ""] ?? 0);
        return diff || a.ticker.localeCompare(b.ticker);
      }
      case "coverage":
        return (
          nullsLast(a.coreCoverageRatio, b.coreCoverageRatio) || a.ticker.localeCompare(b.ticker)
        );
      case "freshness": {
        const diff =
          (FRESHNESS_RANK[b.freshness ?? ""] ?? -1) - (FRESHNESS_RANK[a.freshness ?? ""] ?? -1);
        return diff || a.ticker.localeCompare(b.ticker);
      }
      case "profile":
        return a.researchProfile.localeCompare(b.researchProfile) || a.ticker.localeCompare(b.ticker);
      case "sector":
        return (a.sector ?? "").localeCompare(b.sector ?? "") || a.ticker.localeCompare(b.ticker);
      case "ticker":
      default:
        return a.ticker.localeCompare(b.ticker);
    }
  });
  return copy;
}

export function rowMatchesFilters(row: OpportunityRow, filters: DashboardFlagFilter): boolean {
  if (filters.instrumentType && row.instrumentType !== filters.instrumentType) return false;
  if (filters.shariah && row.shariahCompliant !== true) return false;
  if (filters.board && (row.listingBoard ?? "").toUpperCase() !== filters.board) return false;
  if (filters.cap) {
    if (row.marketCap === null) return false;
    if (capBucket(row.marketCap) !== filters.cap) return false;
  }
  if (filters.confidence && row.confidence !== filters.confidence) return false;
  if (filters.freshness && (row.freshness ?? "").toUpperCase() !== filters.freshness) return false;
  if (filters.profile && row.researchProfile !== filters.profile) return false;
  return true;
}

export function parseListId(value: string | undefined): ListId {
  if (value && (LIST_IDS as readonly string[]).includes(value)) return value as ListId;
  return "watchlist";
}

export function categoryScore(result: ScoreResult, id: string): number | null {
  return result.categories.find((c) => c.id === id)?.score ?? null;
}

/** Mean factor coverage of categories with a positive configured weight. */
export function liveCoverage(result: ScoreResult): number | null {
  const liveSlots = result.categories.filter((c) => c.configuredWeight > 0);
  if (liveSlots.length === 0) return null;
  return liveSlots.reduce((sum, c) => sum + c.coverage, 0) / liveSlots.length;
}

export function mainConcernLabel(result: ScoreResult): string | null {
  const hit = result.concerns[0];
  return hit ? hit.label : null;
}

const ALERT_RESEARCH_LIST_IDS = ["undervalued", "quality", "quality-value", "improving", "discounted"] as const;

export type AlertResearchListId = (typeof ALERT_RESEARCH_LIST_IDS)[number];

type ScreeningRow = Pick<OpportunityRow, "valuationScore" | "qualityScore" | "distanceFrom52wHigh" | "distanceFrom52wHighAvailable">;
type SharedListId = Extract<ListId, AlertResearchListId>;

function rowMatchesSharedList(row: ScreeningRow, list: SharedListId): boolean {
  if (list === "undervalued") return (row.valuationScore ?? -1) >= 70;
  if (list === "quality-value") {
    return (row.qualityScore ?? -1) >= 70 && (row.valuationScore ?? -1) >= 70;
  }
  if (!row.distanceFrom52wHighAvailable || row.distanceFrom52wHigh === null) return false;
  if ((row.qualityScore ?? -1) < 50) return false;
  return row.distanceFrom52wHigh >= 0.15;
}

export function researchListIds(
  row: ScreeningRow & Pick<OpportunityRow, "result" | "catalystWatch"> & {
    /** Newest persisted research scores first. Live run is not prepended. */
    persistedResearchScores: (number | null)[];
  },
): AlertResearchListId[] {
  if (!row.result.eligibility?.eligible) return [];
  return ALERT_RESEARCH_LIST_IDS.filter((id) => {
    if (id === "quality") return (row.qualityScore ?? -1) >= 70;
    if (id === "improving") {
      if (row.persistedResearchScores.length < 2) return false;
      const [latest, previous] = row.persistedResearchScores;
      return latest !== null && previous !== null && latest > previous + 0.5;
    }
    return rowMatchesSharedList(row, id);
  });
}

export function rowMatchesList(row: OpportunityRow, list: ListId, fairRange?: ListFairRange): boolean {
  if (list === "watchlist") return true;
  if (!row.result.eligibility?.eligible) return false;
  if (list === "buy-score") return row.buyScore !== null && row.buyScore > 90;
  if (list === "at-or-below-fair-range") {
    return fairRange?.available === true && isFiniteNumber(row.price) && row.price > 0 && row.price <= fairRange.high;
  }
  return rowMatchesSharedList(row, list);
}
