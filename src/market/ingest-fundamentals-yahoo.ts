import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialPeriods, ingestReports, instruments } from "@/db/schema";
import { persistAnnualPeriod } from "@/ingest/persist-annual-period";
import { recordIngestFailure } from "@/market/refresh-universe";
import { CompositeFundamentalProvider, UnconfiguredSecondaryFundamentalProvider } from "@/providers/composite-fundamentals";
import {
  classifyEmptyYahooResult,
  FundamentalIngestError,
  isUnsupportedYahooListing,
  type FundamentalFailureCode,
} from "@/providers/fundamental-failures";
import type { FundamentalProvider } from "@/providers/types";
import { YahooFundamentalProvider } from "@/providers/yahoo-fundamentals";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";
import {
  DAILY_FUNDAMENTALS_RECHECK_DAYS,
  evaluateFundamentalsFreshness,
} from "@/refresh/fundamentals-freshness";

function sleep(ms: number) {
  return Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

export type TypedFundamentalFailure = {
  ticker: string;
  yahooTicker: string | null;
  mappingTried: string[];
  code: FundamentalFailureCode;
  reason: string;
};

export type YahooFundamentalsReport = {
  kind: "fundamentals-yahoo";
  startedAt: string;
  finishedAt: string;
  attempted: number;
  upserted: number;
  inserted: number;
  filled: number;
  /** Period rows that matched existing Yahoo data with nothing new to fill. */
  unchanged: number;
  skippedHadFilings: number;
  skippedOtherSource: number;
  /** Instruments where at least one period was inserted or filled. */
  instrumentsUpdated: number;
  /** Instruments contacted successfully with no period changes (or skipped as already filed). */
  instrumentsUnchanged: number;
  /**
   * Daily freshness gate only: Yahoo HTTP skipped because complete annuals were
   * still within the recheck window. Counted in instrumentsUnchanged.
   */
  instrumentsSkippedFresh: number;
  /** Instruments that made at least one Yahoo fundamentals HTTP attempt. */
  instrumentsFetched: number;
  failed: TypedFundamentalFailure[];
};

export type YahooFundamentalsImportOptions = {
  rateLimitMs?: number;
  skipIfAnyFilings?: boolean;
  /**
   * When set (daily refresh), skip Yahoo HTTP for instruments whose latest Yahoo
   * annual is complete and was retrieved within `recheckAfterDays`.
   * Default importer / manual backfill leaves this unset → full fetch.
   */
  freshnessGate?: {
    asOf?: Date;
    recheckAfterDays?: number;
  };
};

function defaultProvider(): FundamentalProvider {
  return new CompositeFundamentalProvider([
    new YahooFundamentalProvider(),
    new UnconfiguredSecondaryFundamentalProvider(),
  ]);
}

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const retryable =
        error instanceof FundamentalIngestError
          ? error.retryable
          : error instanceof Error && /HTTP 429|HTTP 5\d\d/.test(error.message);
      if (!retryable || i === attempts - 1) throw error;
      await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

function isFundamentalProvider(value: unknown): value is FundamentalProvider {
  return (
    value !== null &&
    typeof value === "object" &&
    "annualPeriods" in value &&
    typeof (value as FundamentalProvider).annualPeriods === "function"
  );
}

/**
 * Full Yahoo fundamentals import (manual / backfill). Pass `freshnessGate` only from
 * daily refresh so complete, recently retrieved annuals skip HTTP.
 */
export async function importYahooFundamentals(
  providerOrOptions?: FundamentalProvider | YahooFundamentalsImportOptions,
  maybeOptions?: YahooFundamentalsImportOptions,
): Promise<YahooFundamentalsReport> {
  const provider = isFundamentalProvider(providerOrOptions)
    ? providerOrOptions
    : defaultProvider();
  const options = isFundamentalProvider(providerOrOptions) ? maybeOptions : providerOrOptions;
  const startedAt = new Date().toISOString();
  const db = getDb();
  const listed = db
    .select()
    .from(instruments)
    .all()
    .filter((row) => row.listingStatus !== "inactive");
  const skipIfAny = options?.skipIfAnyFilings ?? false;
  const delay = options?.rateLimitMs ?? 200;
  const gate = options?.freshnessGate;
  const gateAsOf = gate?.asOf ?? new Date();
  const recheckAfterDays = gate?.recheckAfterDays ?? DAILY_FUNDAMENTALS_RECHECK_DAYS;
  let upserted = 0;
  let inserted = 0;
  let filled = 0;
  let unchanged = 0;
  let skippedHadFilings = 0;
  let skippedOtherSource = 0;
  let instrumentsUpdated = 0;
  let instrumentsUnchanged = 0;
  let instrumentsSkippedFresh = 0;
  let instrumentsFetched = 0;
  const failed: TypedFundamentalFailure[] = [];
  const retrievedAt = new Date().toISOString();

  for (const [index, instrument] of listed.entries()) {
    const existing = db
      .select()
      .from(financialPeriods)
      .where(eq(financialPeriods.instrumentId, instrument.id))
      .all();
    if (skipIfAny && existing.length > 0) {
      skippedHadFilings += 1;
      instrumentsUnchanged += 1;
      continue;
    }
    if (gate) {
      const yahooAnnuals = existing
        .filter((row) => row.statementType === "annual" && row.source.startsWith("yahoo"))
        .map((row) => ({
          periodEnd: row.periodEnd,
          retrievedAt: row.retrievedAt,
          lineItemsJson: row.lineItemsJson,
        }));
      const decision = evaluateFundamentalsFreshness({
        yahooAnnuals,
        asOf: gateAsOf,
        recheckAfterDays,
      });
      if (!decision.needsRefresh) {
        instrumentsSkippedFresh += 1;
        instrumentsUnchanged += 1;
        continue;
      }
    }
    if (isUnsupportedYahooListing(instrument.name)) {
      const row: TypedFundamentalFailure = {
        ticker: instrument.ticker,
        yahooTicker: instrument.yahooTicker,
        mappingTried: yahooSymbolCandidates(instrument),
        code: "UNSUPPORTED",
        reason: "Yahoo listing looks like an ETF/index fund — statements not forced",
      };
      failed.push(row);
      recordIngestFailure("fundamentals", instrument.ticker, instrument.yahooTicker, row.reason, row.code);
      continue;
    }

    const mappingTried = yahooSymbolCandidates(instrument);
    if (mappingTried.length === 0) {
      const row: TypedFundamentalFailure = {
        ticker: instrument.ticker,
        yahooTicker: null,
        mappingTried,
        code: "TICKER_MAPPING_ERROR",
        reason: "No yahoo_ticker or Bursa code to map",
      };
      failed.push(row);
      recordIngestFailure("fundamentals", instrument.ticker, null, row.reason, row.code);
      continue;
    }

    try {
      let periods: Awaited<ReturnType<FundamentalProvider["annualPeriods"]>> = [];
      let lastError: unknown;
      let fetched = false;
      for (const symbol of mappingTried) {
        try {
          periods = await withRetries(() => provider.annualPeriods(symbol));
          fetched = true;
          if (periods.length) break;
        } catch (error) {
          fetched = true;
          lastError = error;
        }
      }
      if (fetched) instrumentsFetched += 1;
      if (!periods.length && lastError) throw lastError;

      if (provider.profile && mappingTried[0]) {
        const profile = await provider.profile(mappingTried[0]);
        if (profile.sector || profile.industry) {
          db.update(instruments)
            .set({
              sector: instrument.sector ?? profile.sector,
              industry: instrument.industry ?? profile.industry,
              updatedAt: retrievedAt,
            })
            .where(eq(instruments.id, instrument.id))
            .run();
        }
      }

      if (periods.length === 0) {
        const code = classifyEmptyYahooResult({ name: instrument.name, mappingTried });
        const row: TypedFundamentalFailure = {
          ticker: instrument.ticker,
          yahooTicker: mappingTried[0] ?? null,
          mappingTried,
          code,
          reason: "Yahoo returned no annual statements (unavailable, not invented)",
        };
        failed.push(row);
        recordIngestFailure("fundamentals", instrument.ticker, mappingTried[0] ?? null, row.reason, code);
        continue;
      }

      let instrumentChanged = false;
      for (const period of periods) {
        const result = persistAnnualPeriod(instrument.id, period, retrievedAt);
        if (result === "inserted") {
          inserted += 1;
          upserted += 1;
          instrumentChanged = true;
        } else if (result === "filled") {
          filled += 1;
          upserted += 1;
          instrumentChanged = true;
        } else if (result === "skipped_other_source") {
          skippedOtherSource += 1;
        } else if (result === "unchanged") {
          unchanged += 1;
        }
      }
      if (instrumentChanged) instrumentsUpdated += 1;
      else instrumentsUnchanged += 1;
    } catch (error) {
      const code: FundamentalFailureCode =
        error instanceof FundamentalIngestError ? error.code : "UNKNOWN";
      const reason = error instanceof Error ? error.message : "Yahoo fundamentals failed";
      failed.push({
        ticker: instrument.ticker,
        yahooTicker: mappingTried[0] ?? null,
        mappingTried,
        code,
        reason,
      });
      recordIngestFailure("fundamentals", instrument.ticker, mappingTried[0] ?? null, reason, code);
    }
    if (index < listed.length - 1) await sleep(delay);
  }

  const report: YahooFundamentalsReport = {
    kind: "fundamentals-yahoo",
    startedAt,
    finishedAt: new Date().toISOString(),
    attempted: listed.length,
    upserted,
    inserted,
    filled,
    unchanged,
    skippedHadFilings,
    skippedOtherSource,
    instrumentsUpdated,
    instrumentsUnchanged,
    instrumentsSkippedFresh,
    instrumentsFetched,
    failed,
  };
  db.insert(ingestReports)
    .values({
      kind: "fundamentals-yahoo",
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      summaryJson: JSON.stringify({
        ...report,
        failed: report.failed.slice(0, 80),
        failedCount: report.failed.length,
        freshnessGate: gate
          ? { recheckAfterDays, asOf: gateAsOf.toISOString() }
          : null,
      }),
    })
    .run();
  return report;
}
