import type { FairValueResult } from "@/fair-value/types";
import { MIN_USABLE_PEERS } from "@/scoring/peer-group";

export const NO_COMPARABLE_PEERS = `Too few similar companies with usable figures (need at least ${MIN_USABLE_PEERS}). Broader industries are not used.`;

// The local Specialty Chemicals group includes glove makers, plastics, and concrete.
export function isMixedIndustry(industry: string): boolean {
  return /\b(diversified|conglomerates?)\b/i.test(industry) || /^specialty chemicals$/i.test(industry.trim());
}

export function usesBroadGeneralPeers(result: FairValueResult): boolean {
  if (result.researchProfile !== "GENERAL") return false;
  const { peerGroupType, peerSelectionPath } = result.assumptions;
  if (peerGroupType === "INDUSTRY_FAMILY" || peerGroupType === "SECTOR") return true;
  const exactIndustry = peerSelectionPath?.match(/^exact industry “(.+)”$/)?.[1];
  return peerGroupType === "INDUSTRY" && !!exactIndustry && isMixedIndustry(exactIndustry);
}

export const BROAD_PEERS_WITHHELD = "The old estimate compared different kinds of businesses. It is hidden until the next data refresh.";
