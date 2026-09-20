import { fetchYahooDailyBars } from "@/ingest/providers/yahoo-prices";
import type { PriceProvider } from "@/providers/types";

export class YahooPriceProvider implements PriceProvider {
  readonly id = "yahoo-chart";
  dailyBars(yahooTicker: string, range = "5y") {
    return fetchYahooDailyBars(yahooTicker, range);
  }
}
