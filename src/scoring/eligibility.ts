import type { ScoringConfig } from "@/config/load-scoring";
import { dailyPriceBars } from "@/metrics/evidence";
import type { PriceBarSnapshot } from "@/metrics/types";

export type Eligibility = { eligible: boolean; reasons: string[]; medianTradedValue: number | null; priceDays: number };

export function assessEligibility(args: { pn17: boolean; warning?: boolean; coverage: number; bars: PriceBarSnapshot[]; config: ScoringConfig; asOf: string }): Eligibility {
  const bars = dailyPriceBars(args.bars, args.asOf);
  const priceDays = bars.filter((b) => b.close !== null && Number.isFinite(b.close) && b.close > 0).length;
  const recent = bars.slice(-60);
  const tradedValues = recent.flatMap((b) => b.close !== null && Number.isFinite(b.close) && b.close > 0 && b.volume != null && Number.isFinite(b.volume) && b.volume >= 0 ? [b.close * b.volume] : []).sort((a, b) => a - b);
  const medianTradedValue = tradedValues.length === 60 ? (tradedValues[29] + tradedValues[30]) / 2 : null;
  const settings = args.config.eligibility;
  const reasons: string[] = [];
  if (args.pn17 || args.warning) reasons.push("Stored PN17 / warning flag is set.");
  if (medianTradedValue === null) reasons.push("60 sessions of price and volume are required to verify liquidity.");
  else if (medianTradedValue < settings.min_median_traded_value) reasons.push(`Median daily traded value RM ${medianTradedValue.toFixed(0)} is below RM ${settings.min_median_traded_value}.`);
  if (priceDays < settings.min_price_days) reasons.push(`Only ${priceDays} price days; ${settings.min_price_days} required.`);
  if (args.coverage < settings.min_coverage) reasons.push(`Factor coverage ${(args.coverage * 100).toFixed(0)}% is below ${(settings.min_coverage * 100).toFixed(0)}%.`);
  return { eligible: reasons.length === 0, reasons, medianTradedValue, priceDays };
}
