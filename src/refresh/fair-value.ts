import { loadScoringConfig, resolveResearchProfile } from "@/config/load-scoring";
import { getSqlite } from "@/db/client";
import { calculateFairValue, type FairValueInput } from "@/fair-value/orchestrate";
import { persistFairValueRun } from "@/fair-value/persist";
import {
  assessFairValueQuality,
  type FairValueQuality,
  type FairValueQualityAnnual,
} from "@/fair-value/quality";
import type { FairValueResult } from "@/fair-value/types";
import type { PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import { RESEARCH_PROFILES } from "@/research/profiles";
import type { PeerUniverseRow } from "@/scoring/peer-group";
import { periodsToSnapshots } from "@/scoring/valuation-context";
import type { RefreshStatus } from "@/refresh/types";

export type FairValueFailureStage = "calculation" | "quality_assessment" | "persistence";

export type FairValueRefreshFailure = {
  ticker: string;
  stage: FairValueFailureStage;
  message: string;
};

export type FairValueRefreshReport = {
  attempted: number;
  inserted: number;
  unchanged: number;
  failed: FairValueRefreshFailure[];
  unsupported: number;
  noValue: number;
  flagged: number;
  caution: number;
  withheld: number;
  persistenceRefused: boolean;
};

const USEFUL_INPUT_STATUSES = new Set(["SUCCESS", "PARTIAL", "UNCHANGED"]);

type InstrumentRow = {
  id: number;
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  instrumentType: string;
  researchProfile: string | null;
  listingStatus: string;
};

type PeriodRow = {
  instrumentId: number;
  periodEnd: string;
  availableAt: string | null;
  statementType: string;
  source: string;
  fiscalQuarter: number | null;
  lineItemsJson: string | null;
};

type BarRow = PriceBarSnapshot & { instrumentId: number };

export function fairValueInputsReady(
  prior: readonly { dataset: string; status: string }[],
): boolean {
  return prior.some(
    (row) =>
      (row.dataset === "prices" || row.dataset === "fundamentals") &&
      USEFUL_INPUT_STATUSES.has(row.status),
  );
}

export function fairValueRefreshOutcome(report: FairValueRefreshReport): {
  status: RefreshStatus;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  unavailableCount: number;
} {
  const stored = report.inserted + report.unchanged;
  let status: RefreshStatus;
  if (report.attempted === 0 && !report.persistenceRefused) status = "NO_DATA";
  else if (report.persistenceRefused && stored === 0) status = "SOURCE_FAILED";
  else if (report.persistenceRefused) status = "PARTIAL";
  else if (report.failed.length === 0 && report.inserted > 0) status = "SUCCESS";
  else if (report.failed.length === 0) status = "UNCHANGED";
  else if (stored === 0) status = "SOURCE_FAILED";
  else status = "PARTIAL";

  const stages = [...new Set(report.failed.map((row) => row.stage))];
  const failureStage = report.persistenceRefused
    ? "persistence"
    : stages.length === 1
      ? stages[0]
      : stages.length > 1
        ? "mixed"
        : null;
  const errorSummary = report.persistenceRefused
    ? "Fair Value persistence refused: read-only snapshot. Stage: persistence."
    : report.failed.length === 0
      ? null
      : `Fair Value failed for ${report.failed.length} instruments. Stage: ${stages.join(", ")}.`;

  return {
    status,
    errorSummary,
    updatedCount: report.inserted,
    unchangedCount: report.unchanged,
    failedCount: report.failed.length + (report.persistenceRefused ? 1 : 0),
    unavailableCount: 0,
    metadata: {
      unsupported: report.unsupported,
      noValue: report.noValue,
      flagged: report.flagged,
      caution: report.caution,
      withheld: report.withheld,
      failedSample: report.failed.slice(0, 10),
      persistenceRefused: report.persistenceRefused,
      failureStage,
    },
  };
}

export function refreshFairValueUniverse(args: {
  asOf: string;
  /** Calculate one ticker. Peer rows still come from the stored universe. */
  onlyTicker?: string;
  calculate?: (input: FairValueInput) => FairValueResult;
  assess?: (result: FairValueResult, annuals: readonly FairValueQualityAnnual[]) => FairValueQuality;
  persist?: typeof persistFairValueRun;
}): FairValueRefreshReport {
  const calculate = args.calculate ?? calculateFairValue;
  const assess = args.assess ?? assessFairValueQuality;
  const persist = args.persist ?? persistFairValueRun;
  const loaded = loadStoredUniverse();
  const requested = args.onlyTicker?.trim().toUpperCase();
  const listed = requested
    ? loaded.listed.filter((row) => row.ticker.toUpperCase() === requested)
    : loaded.listed;
  const { snapshots, bars, peers } = loaded;
  const report: FairValueRefreshReport = {
    attempted: listed.length,
    inserted: 0,
    unchanged: 0,
    failed: [],
    unsupported: 0,
    noValue: 0,
    flagged: 0,
    caution: 0,
    withheld: 0,
    persistenceRefused: false,
  };
  const config = loadScoringConfig();

  for (const instrument of listed) {
    const periods = snapshots.get(instrument.id) ?? [];
    const annuals = annualsFrom(periods);
    const profile = resolveResearchProfile(
      instrument.instrumentType === "REIT" ? "REIT" : "COMMON_STOCK",
      instrument.ticker,
      { sector: instrument.sector, industry: instrument.industry },
      config,
    ).profile;
    let result: FairValueResult;
    try {
      result = calculate({
        ticker: instrument.ticker,
        researchProfile: profile,
        industry: instrument.industry,
        sector: instrument.sector,
        periods,
        bars: bars.get(instrument.id) ?? [],
        peers,
        asOf: args.asOf,
      });
    } catch (error) {
      report.failed.push({
        ticker: instrument.ticker,
        stage: "calculation",
        message: concise(error),
      });
      continue;
    }

    let quality: FairValueQuality;
    try {
      quality = assess(result, annuals);
    } catch (error) {
      report.failed.push({
        ticker: instrument.ticker,
        stage: "quality_assessment",
        message: concise(error),
      });
      continue;
    }

    let saved: ReturnType<typeof persistFairValueRun>;
    try {
      saved = persist({
        instrumentId: instrument.id,
        result,
        quality,
        calculatedAt: args.asOf,
      });
    } catch (error) {
      report.failed.push({
        ticker: instrument.ticker,
        stage: "persistence",
        message: concise(error),
      });
      continue;
    }
    if (saved == null) {
      report.persistenceRefused = true;
      break;
    }
    if (saved.inserted) report.inserted += 1;
    else report.unchanged += 1;
    if (result.assumptions.modelVersion === "unsupported") report.unsupported += 1;
    if (quality.status === "NO_VALUE") report.noValue += 1;
    if (quality.status === "FLAGGED") report.flagged += 1;
    if (quality.baseUse === "POINT_WITH_CAUTION") report.caution += 1;
    if (quality.baseUse === "POINT_WITHHELD") report.withheld += 1;
  }

  return report;
}

function concise(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 180);
}

function annualsFrom(periods: StatementSnapshot[]): FairValueQualityAnnual[] {
  return periods
    .filter((row) => row.statementType === "annual")
    .map((row) => ({
      periodEnd: row.periodEnd,
      eps: row.eps,
      pat: row.pat,
      shares: row.shares,
      dividendPerShare: row.dividendPerShare,
    }));
}

function loadStoredUniverse(): {
  listed: InstrumentRow[];
  snapshots: Map<number, StatementSnapshot[]>;
  bars: Map<number, PriceBarSnapshot[]>;
  peers: PeerUniverseRow[];
} {
  const sqlite = getSqlite();
  const instruments = sqlite
    .prepare(
      `SELECT id, ticker, name, sector, industry,
              instrument_type AS instrumentType,
              research_profile AS researchProfile,
              listing_status AS listingStatus
       FROM instruments
       ORDER BY ticker ASC`,
    )
    .all() as InstrumentRow[];
  const periods = sqlite
    .prepare(
      `SELECT instrument_id AS instrumentId, period_end AS periodEnd,
              available_at AS availableAt, statement_type AS statementType,
              source, fiscal_quarter AS fiscalQuarter, line_items_json AS lineItemsJson
       FROM financial_periods`,
    )
    .all() as PeriodRow[];
  const barRows = sqlite
    .prepare(
      `SELECT instrument_id AS instrumentId, bar_date AS barDate, close, high, low
       FROM price_bars`,
    )
    .all() as BarRow[];

  const periodRows = new Map<number, PeriodRow[]>();
  for (const row of periods) {
    const list = periodRows.get(row.instrumentId) ?? [];
    list.push(row);
    periodRows.set(row.instrumentId, list);
  }
  const bars = new Map<number, PriceBarSnapshot[]>();
  for (const row of barRows) {
    const list = bars.get(row.instrumentId) ?? [];
    list.push({ barDate: row.barDate, close: row.close, high: row.high, low: row.low });
    bars.set(row.instrumentId, list);
  }
  const snapshots = new Map<number, StatementSnapshot[]>();
  for (const instrument of instruments) {
    snapshots.set(instrument.id, periodsToSnapshots(periodRows.get(instrument.id) ?? []));
  }

  const peers = instruments.map((instrument) => {
    const snaps = snapshots.get(instrument.id) ?? [];
    const annuals = snaps
      .filter((row) => row.statementType === "annual")
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const latest = annuals.length > 0 ? annuals[annuals.length - 1] : null;
    const closes = (bars.get(instrument.id) ?? [])
      .slice()
      .sort((a, b) => b.barDate.localeCompare(a.barDate));
    const close = closes[0] ?? null;
    return {
      ticker: instrument.ticker,
      name: instrument.name,
      listingStatus: instrument.listingStatus,
      instrumentType: instrument.instrumentType,
      researchProfile: storedProfile(instrument.researchProfile),
      industry: instrument.industry,
      sector: instrument.sector,
      lastClose: close?.close ?? null,
      lastCloseDate: close?.barDate ?? null,
      periodEnd: latest?.periodEnd ?? null,
      availableAt: latest?.availableAt ?? null,
      eps: latest?.eps ?? null,
      dividendPerShare: latest?.dividendPerShare ?? null,
      equity: latest?.equity ?? null,
      shares: latest?.shares ?? null,
      revenue: latest?.revenue ?? null,
      pat: latest?.pat ?? null,
    } satisfies PeerUniverseRow;
  });

  return {
    listed: instruments.filter((row) => row.listingStatus !== "inactive"),
    snapshots,
    bars,
    peers,
  };
}

function storedProfile(value: string | null): ResearchProfile {
  if (value && (RESEARCH_PROFILES as readonly string[]).includes(value)) return value as ResearchProfile;
  return "GENERAL";
}
