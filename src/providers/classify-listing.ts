import type { InstrumentType } from "@/db/schema";

const WARRANT_CODE = /^\d{3,5}W[A-Z]$/i;
const WARRANT_NAME = /\bWARRANT\b|\bCALL WARRANT\b|\bPUT WARRANT\b|[- ]W[A-Z]$/i;
const ETF_NAME = /\bETF\b|EXCHANGE[\s-]*TRADED|\bBOND INDEX\b|\bINDEX FUND\b/i;
const REIT_NAME = /\bREIT\b|REAL ESTATE INVESTMENT/i;

export function yahooSymbolParts(symbol: string): { code: string; yahooTicker: string } {
  const yahooTicker = symbol.trim().toUpperCase();
  const code = yahooTicker.replace(/\.KL$/i, "");
  return { code, yahooTicker: yahooTicker.endsWith(".KL") ? yahooTicker : `${code}.KL` };
}

export function shouldExcludeListing(symbol: string, shortName: string, longName: string): string | null {
  const { code } = yahooSymbolParts(symbol);
  const name = `${shortName} ${longName}`.trim();
  if (ETF_NAME.test(name) || ETF_NAME.test(code)) return "ETF excluded";
  if (WARRANT_CODE.test(code) || WARRANT_NAME.test(name)) return "Warrant excluded";
  return null;
}

export function classifyInstrumentType(shortName: string, longName: string): InstrumentType {
  const name = `${shortName} ${longName}`;
  return REIT_NAME.test(name) ? "REIT" : "COMMON_STOCK";
}

export function tickerFromYahoo(shortName: string, code: string): string {
  const cleaned = shortName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (cleaned.length >= 2 && cleaned.length <= 16) return cleaned;
  return code.toUpperCase();
}
