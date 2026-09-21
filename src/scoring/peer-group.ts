import { shouldExcludeListing } from "@/providers/classify-listing";
import { isUnsupportedYahooListing } from "@/providers/fundamental-failures";
import type { ResearchProfile } from "@/research/profiles";

/** Usable peers excluding the subject. Same floor at every hierarchy level. */
export const MIN_USABLE_PEERS = 5;

export type PeerGroupType =
  | "BANK_PROFILE"
  | "REIT_PROFILE"
  | "INDUSTRY"
  | "INDUSTRY_FAMILY"
  | "SECTOR"
  | "NONE";

export type PeerUniverseRow = {
  ticker: string;
  name?: string | null;
  listingStatus?: string | null;
  instrumentType?: string | null;
  researchProfile: ResearchProfile;
  industry: string | null;
  sector: string | null;
  lastClose: number | null;
  lastCloseDate: string | null;
  periodEnd: string | null;
  availableAt: string | null;
  eps: number | null;
  dividendPerShare: number | null;
  equity: number | null;
  shares: number | null;
  revenue: number | null;
  pat: number | null;
};

export type PeerQualityMetric = {
  metricId: string;
  label: string;
  usableCount: number;
  median: number | null;
  subject: number | null;
  vsMedian: "below" | "above" | "in_line" | "unavailable";
  contextLabel: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNAVAILABLE";
  reason: string | null;
};

export type PeerQuality = {
  groupType: PeerGroupType;
  selectionPath: string;
  classificationUsed: {
    researchProfile: ResearchProfile;
    industry: string | null;
    sector: string | null;
  };
  minRequired: number;
  eligibleCount: number;
  usableCount: number;
  metrics: PeerQualityMetric[];
  contextLabel: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNAVAILABLE";
  unavailableReason: string | null;
};

export function emptyPeerQuality(
  profile: ResearchProfile,
  industry: string | null,
  sector: string | null,
  reason: string,
): PeerQuality {
  return {
    groupType: "NONE",
    selectionPath: "none",
    classificationUsed: { researchProfile: profile, industry, sector },
    minRequired: MIN_USABLE_PEERS,
    eligibleCount: 0,
    usableCount: 0,
    metrics: [],
    contextLabel: "UNAVAILABLE",
    unavailableReason: reason,
  };
}

export function isExcludedPeer(row: PeerUniverseRow): boolean {
  if (row.listingStatus && row.listingStatus !== "listed") return true;
  const name = row.name ?? "";
  if (isUnsupportedYahooListing(name)) return true;
  if (shouldExcludeListing(row.ticker, name, name)) return true;
  return false;
}

export function industryFamilyPrefix(industry: string | null | undefined): string | null {
  const text = (industry ?? "").trim();
  const idx = text.indexOf(" - ");
  if (idx <= 0) return null;
  return text.slice(0, idx);
}

function sameIndustry(row: PeerUniverseRow, industry: string): boolean {
  return (row.industry ?? "").trim() === industry;
}

function sameFamily(row: PeerUniverseRow, prefix: string): boolean {
  const industry = (row.industry ?? "").trim();
  return industry === prefix || industry.startsWith(`${prefix} - `);
}

function sameSector(row: PeerUniverseRow, sector: string): boolean {
  return (row.sector ?? "").trim() === sector;
}

export type PeerVoteSpec = { id: string; inVote: boolean };

export function selectPeerSet(args: {
  ticker: string;
  researchProfile: ResearchProfile;
  industry?: string | null;
  sector?: string | null;
  peers: PeerUniverseRow[];
  voteMetricIds: string[];
  metricValue: (metricId: string, row: PeerUniverseRow) => number | null;
}): { rows: PeerUniverseRow[]; qualityBase: Omit<PeerQuality, "metrics" | "contextLabel"> } {
  const industry = (args.industry ?? "").trim();
  const sector = (args.sector ?? "").trim();
  const classificationUsed = {
    researchProfile: args.researchProfile,
    industry: industry || null,
    sector: sector || null,
  };
  const pool = args.peers.filter(
    (row) =>
      row.ticker !== args.ticker &&
      !isExcludedPeer(row) &&
      row.researchProfile === args.researchProfile,
  );

  const levels: { groupType: PeerGroupType; path: string; rows: PeerUniverseRow[] }[] = [];
  if (args.researchProfile === "UNKNOWN") {
    return {
      rows: [],
      qualityBase: {
        groupType: "NONE",
        selectionPath: "unknown-profile",
        classificationUsed,
        minRequired: MIN_USABLE_PEERS,
        eligibleCount: 0,
        usableCount: 0,
        unavailableReason:
          "Research profile UNKNOWN — no peer set (not assumed to be a bank, REIT, or sector median).",
      },
    };
  }
  if (args.researchProfile === "BANK") {
    levels.push({
      groupType: "BANK_PROFILE",
      path: "BANK profile (all Malaysian banks in the BANK research profile)",
      rows: pool,
    });
  } else if (args.researchProfile === "REIT") {
    levels.push({
      groupType: "REIT_PROFILE",
      path: "REIT profile (all Malaysian REITs; not Yahoo sub-industry)",
      rows: pool,
    });
  } else {
    if (industry) {
      levels.push({
        groupType: "INDUSTRY",
        path: `exact industry “${industry}”`,
        rows: pool.filter((row) => sameIndustry(row, industry)),
      });
      const prefix = industryFamilyPrefix(industry);
      if (prefix) {
        levels.push({
          groupType: "INDUSTRY_FAMILY",
          path: `industry family “${prefix} - *” (narrower industry had too few usable peers)`,
          rows: pool.filter((row) => sameFamily(row, prefix)),
        });
      }
    }
    if (sector) {
      levels.push({
        groupType: "SECTOR",
        path: `same sector “${sector}” (narrower industry/family had too few usable peers)`,
        rows: pool.filter((row) => sameSector(row, sector)),
      });
    }
  }

  const tried: string[] = [];
  let closestEligible = 0;
  let closestUsable = 0;
  for (const level of levels) {
    const eligible = level.rows;
    const withClose = eligible.filter((row) => row.lastClose !== null && row.lastClose > 0);
    const usableForVote = args.voteMetricIds.map((id) =>
      withClose.filter((row) => args.metricValue(id, row) !== null).length,
    );
    const bestUsable = usableForVote.length ? Math.max(0, ...usableForVote) : withClose.length;
    tried.push(`${level.path}: eligible ${eligible.length}, best usable metric n=${bestUsable}`);
    if (eligible.length > closestEligible) closestEligible = eligible.length;
    if (bestUsable > closestUsable) closestUsable = bestUsable;
    if (eligible.length >= MIN_USABLE_PEERS && bestUsable >= MIN_USABLE_PEERS) {
      return {
        rows: eligible,
        qualityBase: {
          groupType: level.groupType,
          selectionPath: level.path,
          classificationUsed,
          minRequired: MIN_USABLE_PEERS,
          eligibleCount: eligible.length,
          usableCount: bestUsable,
          unavailableReason: null,
        },
      };
    }
  }

  const reason =
    tried.length === 0
      ? args.researchProfile === "GENERAL" || args.researchProfile === "OTHER_FINANCIAL"
        ? "No stored industry or sector that can form a peer set of 5. Whole-market median is not used."
        : "No peer set for this profile."
      : `No peer set reached ${MIN_USABLE_PEERS} usable names. Tried: ${tried.join("; ")}. Whole Bursa is not used.`;

  return {
    rows: [],
    qualityBase: {
      groupType: "NONE",
      selectionPath: tried.join(" → ") || "none",
      classificationUsed,
      minRequired: MIN_USABLE_PEERS,
      eligibleCount: closestEligible,
      usableCount: closestUsable,
      unavailableReason: reason,
    },
  };
}
