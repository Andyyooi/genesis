export const FUNDAMENTAL_FAILURE_CODES = [
  "NO_DATA",
  "TICKER_MAPPING_ERROR",
  "PROVIDER_ERROR",
  "RATE_LIMIT",
  "PARSING_ERROR",
  "UNSUPPORTED",
  "UNKNOWN",
] as const;

export type FundamentalFailureCode = (typeof FUNDAMENTAL_FAILURE_CODES)[number];

export class FundamentalIngestError extends Error {
  readonly code: FundamentalFailureCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(code: FundamentalFailureCode, message: string, httpStatus?: number | null) {
    super(message);
    this.name = "FundamentalIngestError";
    this.code = code;
    this.httpStatus = httpStatus ?? null;
    this.retryable = code === "RATE_LIMIT" || code === "PROVIDER_ERROR";
  }
}

const ETF_OR_INDEX = /\bETF\b|EXCHANGE[\s-]*TRADED|\bBOND INDEX\b|\bINDEX FUND\b/i;

export function isUnsupportedYahooListing(name: string | null | undefined): boolean {
  return Boolean(name && ETF_OR_INDEX.test(name));
}

export function classifyHttpFailure(status: number, bodySnippet = ""): FundamentalFailureCode {
  if (status === 429 || /too many requests/i.test(bodySnippet)) return "RATE_LIMIT";
  if (status === 404) return "TICKER_MAPPING_ERROR";
  if (status === 401 || status === 403 || status >= 500) return "PROVIDER_ERROR";
  if (status >= 400) return "PROVIDER_ERROR";
  return "UNKNOWN";
}

export function classifyEmptyYahooResult(args: {
  name?: string | null;
  mappingTried: string[];
}): FundamentalFailureCode {
  if (isUnsupportedYahooListing(args.name ?? null)) return "UNSUPPORTED";
  if (args.mappingTried.length === 0) return "TICKER_MAPPING_ERROR";
  return "NO_DATA";
}
