import {
  classifyInstrumentType,
  shouldExcludeListing,
  tickerFromYahoo,
  yahooSymbolParts,
} from "@/providers/classify-listing";
import { createYahooSession, yahooFetch } from "@/providers/yahoo-session";
import type { InstrumentDraft, UniverseProvider } from "@/providers/types";

type ScreenerQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  quoteType?: string;
  exchange?: string;
};

type ScreenerResponse = {
  finance?: {
    result?: Array<{
      count?: number;
      total?: number;
      quotes?: ScreenerQuote[];
    }>;
    error?: { description?: string };
  };
};

const PAGE = 250;

export class YahooMalaysiaUniverseProvider implements UniverseProvider {
  readonly id = "yahoo-screener-my-equity";

  async list(): Promise<InstrumentDraft[]> {
    const session = await createYahooSession();
    const collected: InstrumentDraft[] = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener");
      url.searchParams.set("crumb", session.crumb);
      url.searchParams.set("lang", "en-US");
      url.searchParams.set("region", "US");
      url.searchParams.set("formatted", "false");
      const body = {
        size: PAGE,
        offset,
        sortField: "ticker",
        sortType: "ASC",
        quoteType: "EQUITY",
        query: {
          operator: "AND",
          operands: [{ operator: "EQ", operands: ["region", "my"] }],
        },
      };
      const response = await yahooFetch(url.toString(), session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Yahoo screener HTTP ${response.status}`);
      }
      const json = (await response.json()) as ScreenerResponse;
      if (json.finance?.error) {
        throw new Error(`Yahoo screener: ${json.finance.error.description ?? "error"}`);
      }
      const page = json.finance?.result?.[0];
      const quotes = page?.quotes ?? [];
      total = page?.total ?? offset + quotes.length;
      for (const quote of quotes) {
        const draft = toDraft(quote, this.id);
        if (draft) collected.push(draft);
      }
      if (quotes.length === 0) break;
      offset += quotes.length;
    }
    return collected;
  }
}

function toDraft(quote: ScreenerQuote, source: string): InstrumentDraft | null {
  const symbol = quote.symbol?.trim();
  if (!symbol) return null;
  if ((quote.quoteType ?? "EQUITY") !== "EQUITY") return null;
  const shortName = quote.shortName?.trim() ?? "";
  const longName = quote.longName?.trim() ?? shortName;
  const excluded = shouldExcludeListing(symbol, shortName, longName);
  if (excluded) return null;
  const { code, yahooTicker } = yahooSymbolParts(symbol);
  const instrumentType = classifyInstrumentType(shortName, longName);
  const bursaCode = /^\d/.test(code) ? code : null;
  return {
    ticker: tickerFromYahoo(shortName, code),
    bursaCode,
    yahooTicker,
    name: longName || shortName || code,
    sector: null,
    industry: null,
    listingBoard: null,
    instrumentType,
    pn17: false,
    listingStatus: "listed",
    universeSource: source,
  };
}
