import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Allowed v1 types. Warrants and ETFs are rejected in universe YAML validation. */
export const INSTRUMENT_TYPES = ["COMMON_STOCK", "REIT"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const instruments = sqliteTable("instruments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().unique(),
  bursaCode: text("bursa_code"),
  yahooTicker: text("yahoo_ticker"),
  name: text("name").notNull(),
  sector: text("sector"),
  industry: text("industry"),
    listingBoard: text("listing_board"),
  /** COMMON_STOCK or REIT. Separate from research_profile. */
  instrumentType: text("instrument_type", { enum: INSTRUMENT_TYPES }).notNull(),
  /** GENERAL | BANK | REIT | OTHER_FINANCIAL | UNKNOWN */
  researchProfile: text("research_profile"),
  /** PN17/GN3-style status: warning in the UI, never a silent score deduction. */
  pn17: integer("pn17", { mode: "boolean" }).notNull().default(false),
  currency: text("currency").notNull().default("MYR"),
  shariahCompliant: integer("shariah_compliant", { mode: "boolean" }),
  watchlist: integer("watchlist", { mode: "boolean" }).notNull().default(false),
  listingStatus: text("listing_status").notNull().default("listed"),
  universeSource: text("universe_source"),
  universeSyncedAt: text("universe_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const priceBars = sqliteTable(
  "price_bars",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id),
    barDate: text("bar_date").notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close"),
    volume: real("volume"),
    adjClose: real("adj_close"),
    asOf: text("as_of"),
    source: text("source").notNull(),
    adjusted: integer("adjusted", { mode: "boolean" }).notNull().default(false),
    retrievedAt: text("retrieved_at").notNull(),
  },
  (table) => [
    uniqueIndex("price_bars_instrument_date_source").on(
      table.instrumentId,
      table.barDate,
      table.source,
    ),
  ],
);

export const financialPeriods = sqliteTable(
  "financial_periods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id),
    fiscalYear: integer("fiscal_year"),
    fiscalQuarter: integer("fiscal_quarter"),
    periodEnd: text("period_end").notNull(),
    /** Display label such as FY2025. Not a date. */
    fiscalPeriod: text("fiscal_period"),
    /**
     * Publication datetime. As-of scoring (Phase 4+) may only use rows where
     * available_at <= asOf. If unknown, leave null — do not guess a filing date.
     * Never copy retrieved_at or today's date here.
     */
    availableAt: text("available_at"),
    /** Report/filing calendar date when known (Yahoo reportedDate or CSV). */
    filingDate: text("filing_date"),
    /** csv | yahoo-earnings-reported-date. Not retrieved_at. */
    availableAtSource: text("available_at_source"),
    retrievedAt: text("retrieved_at").notNull(),
    statementType: text("statement_type").notNull(),
    source: text("source").notNull(),
    actualOrEstimate: text("actual_or_estimate").notNull().default("actual"),
    lineItemsJson: text("line_items_json"),
  },
  (table) => [
    uniqueIndex("financial_periods_unique").on(
      table.instrumentId,
      table.periodEnd,
      table.statementType,
      table.source,
    ),
  ],
);

/** Announcements/news ingested from CSV (Phase 8). */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id").references(() => instruments.id),
    occurredAt: text("occurred_at"),
    availableAt: text("available_at"),
    source: text("source"),
    sourceUrl: text("source_url"),
    headline: text("headline"),
    excerpt: text("excerpt"),
    classification: text("classification"),
    relevanceNote: text("relevance_note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_unique").on(table.instrumentId, table.occurredAt, table.source, table.headline),
  ],
);

/** Persisted score runs stub so history/backtests can attach later. */
export const scoreRuns = sqliteTable("score_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: integer("instrument_id")
    .notNull()
    .references(() => instruments.id),
  asOf: text("as_of").notNull(),
  configHash: text("config_hash"),
  instrumentProfile: text("instrument_profile"),
  researchProfile: text("research_profile"),
  researchScore: real("research_score"),
  valuationScore: real("valuation_score"),
  categoryScoresJson: text("category_scores_json"),
  coverageJson: text("coverage_json"),
  dataConfidence: text("data_confidence"),
  evidenceJson: text("evidence_json"),
  valuationContextJson: text("valuation_context_json"),
  createdAt: text("created_at").notNull(),
});

/** Last ingest run so rejected rows and Yahoo misses stay visible. */
export const ingestReports = sqliteTable("ingest_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  summaryJson: text("summary_json").notNull(),
});

/** In-app research alerts (Phase 9). Not email, not a buy/sell signal. */
export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instrumentId: integer("instrument_id")
      .notNull()
      .references(() => instruments.id),
    ticker: text("ticker").notNull(),
    ruleId: text("rule_id").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    href: text("href").notNull(),
    fingerprint: text("fingerprint").notNull(),
    triggeredAt: text("triggered_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("alerts_unique").on(table.instrumentId, table.ruleId, table.fingerprint)],
);

export const alertState = sqliteTable("alert_state", {
  instrumentId: integer("instrument_id")
    .primaryKey()
    .references(() => instruments.id),
  lastResearchScore: real("last_research_score"),
  lastHealthScore: real("last_health_score"),
  lastConcernIdsJson: text("last_concern_ids_json").notNull().default("[]"),
  lastListIdsJson: text("last_list_ids_json").notNull().default("[]"),
  lastEventKeysJson: text("last_event_keys_json").notNull().default("[]"),
  lastClose: real("last_close"),
  lastCloseDate: text("last_close_date"),
  updatedAt: text("updated_at").notNull(),
});

export const ingestFailures = sqliteTable("ingest_failures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  ticker: text("ticker"),
  yahooTicker: text("yahoo_ticker"),
  reason: text("reason").notNull(),
  failureCode: text("failure_code"),
  createdAt: text("created_at").notNull(),
});

export const marketScanRuns = sqliteTable("market_scan_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  asOf: text("as_of").notNull(),
  summaryJson: text("summary_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const marketScanRows = sqliteTable("market_scan_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => marketScanRuns.id),
  instrumentId: integer("instrument_id")
    .notNull()
    .references(() => instruments.id),
  ticker: text("ticker").notNull(),
  payloadJson: text("payload_json").notNull(),
});

