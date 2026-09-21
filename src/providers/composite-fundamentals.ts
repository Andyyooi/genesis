import { mergeLineItems } from "@/ingest/merge-line-items";
import type { FundamentalPeriodDraft, FundamentalProvider } from "@/providers/types";

/** Reserved for a future free/official filing source. Returns nothing until configured. */
export class UnconfiguredSecondaryFundamentalProvider implements FundamentalProvider {
  readonly id = "secondary-unconfigured";

  async annualPeriods(): Promise<FundamentalPeriodDraft[]> {
    return [];
  }
}

/** Tries providers in order. Merges extra years/nulls; does not replace stored numbers in memory. */
export class CompositeFundamentalProvider implements FundamentalProvider {
  readonly id = "composite-fundamentals";

  constructor(private readonly providers: FundamentalProvider[]) {}

  async profile(yahooTicker: string) {
    for (const provider of this.providers) {
      if (!provider.profile) continue;
      const row = await provider.profile(yahooTicker);
      if (row.sector || row.industry) return row;
    }
    return { sector: null, industry: null };
  }

  async annualPeriods(yahooTicker: string): Promise<FundamentalPeriodDraft[]> {
    const byEnd = new Map<string, FundamentalPeriodDraft>();
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        const periods = await provider.annualPeriods(yahooTicker);
        for (const period of periods) {
          const hit = byEnd.get(period.periodEnd);
          if (!hit) {
            byEnd.set(period.periodEnd, {
              ...period,
              lineItems: { ...period.lineItems },
            });
          } else {
            hit.lineItems = mergeLineItems(hit.lineItems, period.lineItems);
            if (!hit.availableAt && period.availableAt) hit.availableAt = period.availableAt;
          }
        }
      } catch (error) {
        lastError = error;
      }
    }
    const rows = [...byEnd.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    if (rows.length === 0 && lastError) throw lastError;
    return rows;
  }
}
