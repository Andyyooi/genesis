import { getSqlite } from "@/db/client";
import { historicalValuationStatus, type HistoricalValuationStatus } from "@/db/point-in-time";
import type { LineItems } from "@/ingest/types";
import type { MetricValue, PriceBarSnapshot, StatementSnapshot } from "@/metrics/types";
import type { ResearchProfile } from "@/research/profiles";
import type { DataConfidence, DataCoverage } from "@/scoring/types";
import {
  emptyPeerQuality,
  MIN_USABLE_PEERS,
  selectPeerSet,
  type PeerQuality,
  type PeerUniverseRow,
} from "@/scoring/peer-group";

export type { PeerQuality, PeerUniverseRow } from "@/scoring/peer-group";
export { MIN_USABLE_PEERS } from "@/scoring/peer-group";

export const CONTEXT_LABELS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNAVAILABLE"] as const;
export type ContextLabel = (typeof CONTEXT_LABELS)[number];

export const MIN_HISTORICAL_POINTS = 3;
/** @deprecated use MIN_USABLE_PEERS */
export const MIN_PEER_BANK_REIT = MIN_USABLE_PEERS;
/** @deprecated use MIN_USABLE_PEERS */
export const MIN_PEER_GENERAL = MIN_USABLE_PEERS;
export const PRICE_ALIGN_DAYS = 21;

const PERIOD_END_LIMITATION =
  "Period-end price vs that period’s earnings, filing date unknown. This is not look-ahead-safe point-in-time P/E.";

export type ContextDirection = "lower_better" | "higher_better";

export type ContextMetricStats = {
  metricId: string;
  label: string;
  direction: ContextDirection;
  inVote: boolean;
  current: number | null;
  median: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  percentile: number | null;
  sampleSize: number;
  labelForMetric: ContextLabel;
  fact: string;
  currentUnavailableReason: string | null;
};

export type ValuationContextBlock = {
  kind: "historical" | "peer";
  label: ContextLabel;
  facts: string[];
  limitation: string | null;
  lookAheadSafe: boolean;
  groupDescription: string | null;
  sampleRule: string;
  metrics: ContextMetricStats[];
  confidenceLevel: DataConfidence["level"] | null;
  freshness: DataCoverage["freshness"] | null;
  historicalValuationStatus: HistoricalValuationStatus;
  peerQuality: PeerQuality | null;
};

export type ValuationContextResult = {
  historical: ValuationContextBlock;
  peer: ValuationContextBlock;
};

export type HistoricalPoint = {
  periodEnd: string;
  availableAt: string | null;
  priceDate: string;
  close: number;
  eps: number | null;
  dividendPerShare: number | null;
  equity: number | null;
  shares: number | null;
  revenue: number | null;
  pat: number | null;
};

type MetricSpec = {
  id: string;
  label: string;
  direction: ContextDirection;
  inVote: boolean;
  unit: "ratio" | "yield" | "premium";
};

function profileSpecs(profile: ResearchProfile): MetricSpec[] {
  if (profile === "BANK") {
    return [
      { id: "price_to_book", label: "Price / book", direction: "lower_better", inVote: true, unit: "ratio" },
      { id: "dividend_yield", label: "Dividend yield", direction: "higher_better", inVote: true, unit: "yield" },
      { id: "price_to_earnings", label: "Price / EPS", direction: "lower_better", inVote: true, unit: "ratio" },
      { id: "roe", label: "ROE", direction: "higher_better", inVote: false, unit: "yield" },
    ];
  }
  if (profile === "REIT") {
    return [
      {
        id: "dividend_yield",
        label: "Distribution yield (DPU / price)",
        direction: "higher_better",
        inVote: true,
        unit: "yield",
      },
      {
        id: "book_nav_premium",
        label: "Price vs book NAV",
        direction: "lower_better",
        inVote: true,
        unit: "premium",
      },
      { id: "price_to_book", label: "Price / book", direction: "lower_better", inVote: false, unit: "ratio" },
    ];
  }
  return [
    { id: "price_to_earnings", label: "Price / EPS", direction: "lower_better", inVote: true, unit: "ratio" },
    { id: "dividend_yield", label: "Dividend yield", direction: "higher_better", inVote: true, unit: "yield" },
    { id: "price_to_book", label: "Price / book", direction: "lower_better", inVote: true, unit: "ratio" },
    { id: "price_to_revenue", label: "Price / sales", direction: "lower_better", inVote: false, unit: "ratio" },
  ];
}

export function emptyValuationContext(reason: string): ValuationContextResult {
  const block = (kind: "historical" | "peer"): ValuationContextBlock => ({
    kind,
    label: "UNAVAILABLE",
    facts: [reason],
    limitation: reason,
    lookAheadSafe: false,
    groupDescription: null,
    sampleRule: kind === "historical" ? `Need ${MIN_HISTORICAL_POINTS} period-end points` : "Peer sample too small",
    metrics: [],
    confidenceLevel: null,
    freshness: null,
    historicalValuationStatus: "UNAVAILABLE",
    peerQuality: kind === "peer" ? emptyPeerQuality("GENERAL", null, null, reason) : null,
  });
  return { historical: block("historical"), peer: block("peer") };
}

export function addCalendarDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const next = new Date(ms + days * 24 * 3600 * 1000);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function closeOnOrBefore(
  bars: PriceBarSnapshot[],
  asOfDate: string,
  maxGapDays = PRICE_ALIGN_DAYS,
): { close: number; barDate: string } | null {
  const target = asOfDate.slice(0, 10);
  const floor = addCalendarDays(target, -maxGapDays);
  const eligible = bars
    .filter((bar) => bar.close !== null && bar.close > 0 && bar.barDate <= target && bar.barDate >= floor)
    .sort((a, b) => b.barDate.localeCompare(a.barDate));
  const hit = eligible[0];
  if (!hit || hit.close === null) return null;
  return { close: hit.close, barDate: hit.barDate };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function percentileRank(value: number, sample: number[]): number | null {
  if (!sample.length) return null;
  const sorted = [...sample].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < value).length;
  const equal = sorted.filter((x) => x === value).length;
  return ((below + 0.5 * equal) / sorted.length) * 100;
}

export function labelFromPercentile(percentile: number, direction: ContextDirection): ContextLabel {
  const cheapSide = direction === "lower_better" ? percentile : 100 - percentile;
  if (cheapSide <= 35) return "POSITIVE";
  if (cheapSide >= 65) return "NEGATIVE";
  return "NEUTRAL";
}

export function combineLabels(labels: ContextLabel[]): ContextLabel {
  const usable = labels.filter((l) => l !== "UNAVAILABLE");
  if (!usable.length) return "UNAVAILABLE";
  const score = usable.reduce((sum, l) => sum + (l === "POSITIVE" ? 1 : l === "NEGATIVE" ? -1 : 0), 0);
  if (score > 0) return "POSITIVE";
  if (score < 0) return "NEGATIVE";
  return "NEUTRAL";
}

function ratio(numer: number | null, denom: number | null): number | null {
  if (numer === null || denom === null || denom === 0) return null;
  return numer / denom;
}

export function metricFromInputs(
  id: string,
  close: number | null,
  row: {
    eps: number | null;
    dividendPerShare: number | null;
    equity: number | null;
    shares: number | null;
    revenue: number | null;
    pat: number | null;
  },
): { value: number | null; reason: string | null } {
  if (close === null || close <= 0) return { value: null, reason: "Last close is unavailable" };
  if (id === "price_to_earnings") {
    if (row.eps === null) return { value: null, reason: "EPS is unavailable" };
    if (row.eps <= 0) return { value: null, reason: "EPS is zero or negative — P/E is unavailable (not 0)" };
    return { value: close / row.eps, reason: null };
  }
  if (id === "dividend_yield") {
    if (row.dividendPerShare === null) return { value: null, reason: "Dividend / DPU is unavailable — not estimated as 0" };
    return { value: row.dividendPerShare / close, reason: null };
  }
  if (id === "price_to_book") {
    const book = ratio(row.equity, row.shares);
    if (book === null || book <= 0) return { value: null, reason: "Book NAV is unavailable (needs equity and shares)" };
    return { value: close / book, reason: null };
  }
  if (id === "book_nav_premium") {
    const book = ratio(row.equity, row.shares);
    if (book === null || book === 0) return { value: null, reason: "Book NAV is unavailable (needs equity and shares)" };
    return { value: (close - book) / book, reason: null };
  }
  if (id === "price_to_revenue") {
    const sales = ratio(row.revenue, row.shares);
    if (sales === null || sales <= 0) return { value: null, reason: "Revenue per share is unavailable" };
    return { value: close / sales, reason: null };
  }
  if (id === "roe") {
    if (row.pat === null || row.equity === null || row.equity === 0) {
      return { value: null, reason: "ROE needs PAT and equity" };
    }
    return { value: row.pat / row.equity, reason: null };
  }
  return { value: null, reason: "Unknown metric" };
}

function formatValue(id: string, value: number, spec: MetricSpec): string {
  if (spec.unit === "yield" || spec.unit === "premium") return `${(value * 100).toFixed(1)}%`;
  if (id === "price_to_earnings" || id === "price_to_book" || id === "price_to_revenue") return value.toFixed(1);
  return value.toFixed(2);
}

function displayLabel(label: ContextLabel): string {
  if (label === "POSITIVE") return "Positive";
  if (label === "NEGATIVE") return "Negative";
  if (label === "NEUTRAL") return "Neutral";
  return "Unavailable";
}

function relationPhrase(current: number, med: number, direction: ContextDirection): string {
  if (current === med) return "in line with";
  const cheaper = direction === "lower_better" ? current < med : current > med;
  if (cheaper) return "below";
  return "above";
}

function yieldRelation(current: number, med: number): string {
  if (current === med) return "in line with";
  if (current > med) return "above";
  return "below";
}

function metricFact(args: {
  spec: MetricSpec;
  stats: Omit<ContextMetricStats, "fact" | "labelForMetric">;
  vs: "this name’s period-end" | "peer";
}): { fact: string; labelForMetric: ContextLabel } {
  const { spec, stats, vs } = args;
  if (stats.current === null) {
    return {
      fact: `${spec.label}: unavailable (${stats.currentUnavailableReason ?? "missing inputs"}). Not estimated.`,
      labelForMetric: "UNAVAILABLE",
    };
  }
  if (stats.sampleSize < (vs === "peer" ? 1 : MIN_HISTORICAL_POINTS) || stats.median === null) {
    return {
      fact: `${spec.label}: current ${formatValue(spec.id, stats.current, spec)}, but the comparison sample is too small (n=${stats.sampleSize}).`,
      labelForMetric: "UNAVAILABLE",
    };
  }
  const rel =
    spec.unit === "yield"
      ? yieldRelation(stats.current, stats.median)
      : relationPhrase(stats.current, stats.median, spec.direction);
  const range =
    stats.min !== null && stats.max !== null
      ? `range ${formatValue(spec.id, stats.min, spec)}–${formatValue(spec.id, stats.max, spec)}`
      : "range unavailable";
  const pct =
    stats.percentile !== null ? `, percentile ${stats.percentile.toFixed(0)}` : "";
  const labelForMetric = stats.percentile === null ? "UNAVAILABLE" : labelFromPercentile(stats.percentile, spec.direction);
  const vsNoun = vs === "peer" ? "peer median" : "this name’s period-end median";
  return {
    fact: `Current ${spec.label} ${formatValue(spec.id, stats.current, spec)} is ${rel} the ${vsNoun} of ${formatValue(spec.id, stats.median, spec)} (${range}, n=${stats.sampleSize}${pct}). This is a comparison, not a buy or sell.`,
    labelForMetric,
  };
}

export function buildHistoricalPoints(
  periods: StatementSnapshot[],
  bars: PriceBarSnapshot[],
): { points: HistoricalPoint[]; lookAheadSafe: boolean } {
  const annuals = [...periods]
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const allHaveFiling = annuals.length > 0 && annuals.every((row) => Boolean(row.availableAt));
  const points: HistoricalPoint[] = [];
  for (const row of annuals) {
    const asOf = allHaveFiling && row.availableAt ? row.availableAt.slice(0, 10) : row.periodEnd.slice(0, 10);
    const px = closeOnOrBefore(bars, asOf);
    if (!px) continue;
    points.push({
      periodEnd: row.periodEnd,
      availableAt: row.availableAt,
      priceDate: px.barDate,
      close: px.close,
      eps: row.eps,
      dividendPerShare: row.dividendPerShare,
      equity: row.equity,
      shares: row.shares,
      revenue: row.revenue,
      pat: row.pat,
    });
  }
  return { points, lookAheadSafe: allHaveFiling && points.length > 0 };
}

function currentFromMetrics(metrics: MetricValue[], id: string): { value: number | null; reason: string | null } {
  const row = metrics.find((m) => m.id === id);
  if (!row) return { value: null, reason: "Metric was not computed" };
  if (!row.available || row.value === null) return { value: null, reason: row.reason ?? "Unavailable" };
  return { value: row.value, reason: null };
}

function currentFromHeadline(
  metrics: MetricValue[],
  spec: MetricSpec,
  lastClose: number | null,
  latest: StatementSnapshot | null,
): { value: number | null; reason: string | null } {
  const fromMetrics = currentFromMetrics(metrics, spec.id);
  if (fromMetrics.value !== null) return fromMetrics;
  if (!latest) return { value: null, reason: fromMetrics.reason ?? "No latest annual period" };
  return metricFromInputs(spec.id, lastClose, latest);
}

function statsFromSample(
  spec: MetricSpec,
  current: { value: number | null; reason: string | null },
  sample: number[],
  minN: number,
  vs: "this name’s period-end" | "peer",
): ContextMetricStats {
  const usable = sample.filter((n) => Number.isFinite(n));
  const med = usable.length >= minN ? median(usable) : null;
  const percentile = current.value !== null && usable.length >= minN ? percentileRank(current.value, usable) : null;
  const base = {
    metricId: spec.id,
    label: spec.label,
    direction: spec.direction,
    inVote: spec.inVote,
    current: current.value,
    median: med,
    average: usable.length >= minN ? mean(usable) : null,
    min: usable.length >= minN ? Math.min(...usable) : null,
    max: usable.length >= minN ? Math.max(...usable) : null,
    percentile,
    sampleSize: usable.length,
    currentUnavailableReason: current.reason,
  };
  const { fact, labelForMetric } = metricFact({ spec, stats: base, vs });
  return { ...base, fact, labelForMetric };
}

export function buildValuationContext(args: {
  ticker: string;
  researchProfile: ResearchProfile;
  industry?: string | null;
  sector?: string | null;
  periods: StatementSnapshot[];
  bars: PriceBarSnapshot[];
  metrics: MetricValue[];
  peers: PeerUniverseRow[];
  dataConfidence?: DataConfidence;
  dataCoverage?: DataCoverage;
}): ValuationContextResult {
  const specs = profileSpecs(args.researchProfile);
  const lastCloseMetric = args.metrics.find((m) => m.id === "last_close");
  const lastClose = lastCloseMetric?.available ? lastCloseMetric.value : null;
  const latestAnnual = [...args.periods]
    .filter((row) => row.statementType === "annual")
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null;

  const hist = buildHistoricalPoints(args.periods, args.bars);
  const historicalMetrics = specs.map((spec) => {
    const sample = hist.points
      .map((p) => metricFromInputs(spec.id, p.close, p).value)
      .filter((n): n is number => n !== null);
    const current = currentFromHeadline(args.metrics, spec, lastClose, latestAnnual);
    return statsFromSample(spec, current, sample, MIN_HISTORICAL_POINTS, "this name’s period-end");
  });
  const histVote = historicalMetrics.filter((m) => m.inVote).map((m) => m.labelForMetric);
  const histLabel = combineLabels(histVote);
  const histFacts = historicalMetrics.map((m) => m.fact);
  const histLimitation = hist.lookAheadSafe
    ? "Historical series uses price on or before each filing’s available_at with that period’s line items."
    : PERIOD_END_LIMITATION;
  const histStatus = historicalValuationStatus({
    pointCount: hist.points.length,
    allPointsHaveAvailableAt: hist.lookAheadSafe,
  });
  histFacts.unshift(
    `Historical valuation status: ${histStatus}${histStatus === "PERIOD_END_ONLY" ? " — period-end price vs that period’s earnings; not look-ahead-safe." : histStatus === "POINT_IN_TIME_SAFE" ? " — prices aligned to available_at." : "."}`,
  );
  if (histLabel === "UNAVAILABLE") {
    histFacts.unshift(
      `Historical context is unavailable: need at least ${MIN_HISTORICAL_POINTS} period-end points per voting metric overlapping stored prices.`,
    );
  }
  histFacts.push(
    `Data confidence ${args.dataConfidence?.level ?? "not attached"} · freshness ${args.dataCoverage?.freshness ?? "UNKNOWN"}. Missing inputs stay unavailable.`,
  );
  if (args.researchProfile === "GENERAL") {
    histFacts.push("EV/EBITDA and FCF yield are not in stored snapshots — omitted, not estimated.");
  }
  if (args.researchProfile === "BANK") {
    histFacts.push("Bank historical context uses P/B and yield. EV/EBITDA and FCF are not required.");
  }
  if (args.researchProfile === "REIT") {
    histFacts.push("REIT historical context uses distribution yield and book NAV. Industrial FCF is not used.");
  }

  const selected = selectPeerSet({
    ticker: args.ticker,
    researchProfile: args.researchProfile,
    industry: args.industry ?? null,
    sector: args.sector ?? null,
    peers: args.peers,
    voteMetricIds: specs.filter((s) => s.inVote).map((s) => s.id),
    metricValue: (id, row) => metricFromInputs(id, row.lastClose, row).value,
  });
  const peerRows = selected.rows;
  const peerMetrics = specs.map((spec) => {
    const sample = peerRows
      .map((row) => metricFromInputs(spec.id, row.lastClose, row).value)
      .filter((n): n is number => n !== null);
    const current = currentFromHeadline(args.metrics, spec, lastClose, latestAnnual);
    return statsFromSample(spec, current, sample, MIN_USABLE_PEERS, "peer");
  });
  let peerLabel: ContextLabel = "UNAVAILABLE";
  const peerFacts: string[] = [];
  let peerLimitation: string | null = selected.qualityBase.unavailableReason;
  const vote = peerMetrics.filter((m) => m.inVote);
  const enough = vote.filter((m) => m.sampleSize >= MIN_USABLE_PEERS && m.labelForMetric !== "UNAVAILABLE");
  if (selected.qualityBase.groupType !== "NONE" && enough.length) {
    peerLabel = combineLabels(enough.map((m) => m.labelForMetric));
    peerLimitation = null;
  } else if (!peerLimitation) {
    peerLimitation = `Peer sample is too small (need ${MIN_USABLE_PEERS} usable names per metric, excluding this ticker). No fake median.`;
  }
  const peerQuality: PeerQuality = {
    ...selected.qualityBase,
    metrics: peerMetrics.map((m) => ({
      metricId: m.metricId,
      label: m.label,
      usableCount: m.sampleSize,
      median: m.median,
      subject: m.current,
      vsMedian:
        m.current === null || m.median === null
          ? "unavailable"
          : m.current === m.median
            ? "in_line"
            : m.current < m.median
              ? "below"
              : "above",
      contextLabel: m.labelForMetric,
      reason: m.currentUnavailableReason,
    })),
    contextLabel: peerLabel,
    unavailableReason: peerLimitation,
  };
  peerFacts.push(
    `Peer group: ${peerQuality.usableCount} usable peers (${peerQuality.eligibleCount} eligible). Path: ${peerQuality.selectionPath}.`,
  );
  if (peerLimitation) peerFacts.push(peerLimitation);
  peerFacts.push(...peerMetrics.map((m) => m.fact));
  peerFacts.push(
    `Data confidence ${args.dataConfidence?.level ?? "not attached"} · freshness ${args.dataCoverage?.freshness ?? "UNKNOWN"}.`,
  );
  if (args.researchProfile === "BANK") {
    peerFacts.push("Bank peers use P/B, P/E, and yield. EV/EBITDA and FCF are not required.");
  }
  if (args.researchProfile === "REIT") {
    peerFacts.push("REIT peers use distribution yield and book NAV. Industrial FCF and ordinary P/E are not in the vote.");
  }

  return {
    historical: {
      kind: "historical",
      label: histLabel,
      facts: histFacts,
      limitation: histLimitation,
      lookAheadSafe: hist.lookAheadSafe,
      groupDescription: "This name’s own annuals aligned to period-end (or filing) close",
      sampleRule: `At least ${MIN_HISTORICAL_POINTS} overlapping annuals`,
      metrics: historicalMetrics,
      confidenceLevel: args.dataConfidence?.level ?? null,
      freshness: args.dataCoverage?.freshness ?? null,
      historicalValuationStatus: histStatus,
      peerQuality: null,
    },
    peer: {
      kind: "peer",
      label: peerLabel,
      facts: peerFacts,
      limitation: peerLimitation,
      lookAheadSafe: false,
      groupDescription: peerQuality.selectionPath,
      sampleRule: `At least ${MIN_USABLE_PEERS} usable peers excluding self`,
      metrics: peerMetrics,
      confidenceLevel: args.dataConfidence?.level ?? null,
      freshness: args.dataCoverage?.freshness ?? null,
      historicalValuationStatus: "UNAVAILABLE",
      peerQuality,
    },
  };
}

function parseLineItems(json: string | null): Partial<LineItems> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Partial<LineItems>;
  } catch {
    return {};
  }
}

export function periodsToSnapshots(
  rows: {
    periodEnd: string;
    availableAt: string | null;
    statementType: string;
    source: string;
    fiscalQuarter: number | null;
    lineItemsJson: string | null;
  }[],
): StatementSnapshot[] {
  return rows.map((row) => {
    const items = parseLineItems(row.lineItemsJson);
    return {
      periodEnd: row.periodEnd,
      availableAt: row.availableAt,
      statementType: row.statementType,
      source: row.source,
      fiscalQuarter: row.fiscalQuarter,
      revenue: items.revenue ?? null,
      pat: items.pat ?? null,
      eps: items.eps ?? null,
      equity: items.equity ?? null,
      totalDebt: items.totalDebt ?? null,
      cash: items.cash ?? null,
      ocf: items.ocf ?? null,
      capex: items.capex ?? null,
      shares: items.shares ?? null,
      dividendPerShare: items.dividendPerShare ?? null,
      navPerShare: items.navPerShare ?? null,
      totalAssets: items.totalAssets ?? null,
      grossProfit: null,
      operatingProfit: null,
      ebitda: null,
      ebit: null,
      interestExpense: null,
    };
  });
}

let peerCache: { at: number; rows: PeerUniverseRow[] } | null = null;
const PEER_CACHE_MS = 5 * 60 * 1000;

export function clearPeerUniverseCache() {
  peerCache = null;
}

export function loadPeerUniverse(force = false): PeerUniverseRow[] {
  if (!force && peerCache && Date.now() - peerCache.at < PEER_CACHE_MS) {
    return peerCache.rows;
  }
  const sqlite = getSqlite();
  const names = sqlite
    .prepare(
      `SELECT id, ticker, name, listing_status as listingStatus, instrument_type as instrumentType,
              research_profile as researchProfile, industry, sector FROM instruments`,
    )
    .all() as {
    id: number;
    ticker: string;
    name: string;
    listingStatus: string | null;
    instrumentType: string | null;
    researchProfile: string | null;
    industry: string | null;
    sector: string | null;
  }[];
  const lastBars = sqlite
    .prepare(
      `SELECT p.instrument_id as instrumentId, p.bar_date as barDate, p.close as close
       FROM price_bars p
       INNER JOIN (
         SELECT instrument_id, MAX(bar_date) as d FROM price_bars WHERE close IS NOT NULL GROUP BY instrument_id
       ) t ON t.instrument_id = p.instrument_id AND t.d = p.bar_date
       WHERE p.close IS NOT NULL`,
    )
    .all() as { instrumentId: number; barDate: string; close: number | null }[];
  const annuals = sqlite
    .prepare(
      `SELECT fp.instrument_id as instrumentId, fp.period_end as periodEnd, fp.available_at as availableAt, fp.line_items_json as lineItemsJson
       FROM financial_periods fp
       INNER JOIN (
         SELECT instrument_id, MAX(period_end) as d FROM financial_periods WHERE statement_type = 'annual' GROUP BY instrument_id
       ) t ON t.instrument_id = fp.instrument_id AND t.d = fp.period_end
       WHERE fp.statement_type = 'annual'`,
    )
    .all() as {
    instrumentId: number;
    periodEnd: string;
    availableAt: string | null;
    lineItemsJson: string | null;
  }[];
  const barById = new Map(lastBars.map((row) => [row.instrumentId, row]));
  const annualById = new Map(annuals.map((row) => [row.instrumentId, row]));
  const rows: PeerUniverseRow[] = names.map((name) => {
    const bar = barById.get(name.id);
    const period = annualById.get(name.id);
    const items = parseLineItems(period?.lineItemsJson ?? null);
    return {
      ticker: name.ticker,
      name: name.name,
      listingStatus: name.listingStatus,
      instrumentType: name.instrumentType,
      researchProfile: (name.researchProfile ?? "GENERAL") as ResearchProfile,
      industry: name.industry,
      sector: name.sector,
      lastClose: bar?.close ?? null,
      lastCloseDate: bar?.barDate ?? null,
      periodEnd: period?.periodEnd ?? null,
      availableAt: period?.availableAt ?? null,
      eps: items.eps ?? null,
      dividendPerShare: items.dividendPerShare ?? null,
      equity: items.equity ?? null,
      shares: items.shares ?? null,
      revenue: items.revenue ?? null,
      pat: items.pat ?? null,
    };
  });
  peerCache = { at: Date.now(), rows };
  return rows;
}

export function formatContextLabel(label: ContextLabel): string {
  return displayLabel(label);
}
