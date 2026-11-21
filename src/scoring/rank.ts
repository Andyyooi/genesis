export type RankObservation = { ticker: string; group: string; sector: string | null; value: number | null };
export type PercentileEvidence = { market: number; sector: number; blended: number; marketCount: number; sectorCount: number; sectorFallback: boolean };

/** Midranks: ties share their average position; a singleton is neutral at 50. */
export function percentile(value: number, sample: number[], lowerBetter = false): number {
  const values = sample.filter(Number.isFinite);
  if (values.length <= 1) return 50;
  const below = values.filter((n) => n < value).length;
  const equal = values.filter((n) => n === value).length;
  const rank = 100 * (below + (equal - 1) / 2) / (values.length - 1);
  return lowerBetter ? 100 - rank : rank;
}

export function rankCrossSection(rows: RankObservation[], lowerBetter: boolean, minimumSector = 8, sectorBlend = 0.5): Map<string, PercentileEvidence> {
  const available = rows.filter((row): row is RankObservation & { value: number } => row.value !== null && Number.isFinite(row.value));
  const result = new Map<string, PercentileEvidence>();
  for (const row of available) {
    const group = available.filter((peer) => peer.group === row.group);
    const sector = row.sector ? group.filter((peer) => peer.sector?.trim().toLowerCase() === row.sector!.trim().toLowerCase()) : [];
    const fallback = sector.length < minimumSector;
    const marketRank = percentile(row.value, group.map((p) => p.value), lowerBetter);
    const sectorRank = fallback ? marketRank : percentile(row.value, sector.map((p) => p.value), lowerBetter);
    result.set(row.ticker, { market: marketRank, sector: sectorRank, blended: marketRank * (1 - sectorBlend) + sectorRank * sectorBlend, marketCount: group.length, sectorCount: sector.length, sectorFallback: fallback });
  }
  return result;
}
