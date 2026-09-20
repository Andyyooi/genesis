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
  /** Phase 4 scoring selects factor profile default vs reit from this field. */
  instrumentType: text("instrument_type", { enum: INSTRUMENT_TYPES }).notNull(),
  /** PN17/GN3-style status: warning in the UI, never a silent score deduction. */
  pn17: integer("pn17", { mode: "boolean" }).notNull().default(false),
  currency: text("currency").notNull().default("MYR"),
  shariahCompliant: integer("shariah_compliant", { mode: "boolean" }),
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
    /**
     * Publication datetime. As-of scoring (Phase 4+) may only use rows where
     * available_at <= asOf. If unknown, leave null — do not guess a filing date.
     */
    availableAt: text("available_at"),
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

/** Announcements/news stub. Ingest comes in a later phase. */
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: integer("instrument_id").references(() => instruments.id),
  occurredAt: text("occurred_at"),
  availableAt: text("available_at"),
  source: text("source"),
  sourceUrl: text("source_url"),
  headline: text("headline"),
  excerpt: text("excerpt"),
  classification: text("classification"),
  createdAt: text("created_at").notNull(),
});

/** Persisted score runs stub so history/backtests can attach later. */
export const scoreRuns = sqliteTable("score_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: integer("instrument_id")
    .notNull()
    .references(() => instruments.id),
  asOf: text("as_of").notNull(),
  configHash: text("config_hash"),
  instrumentProfile: text("instrument_profile"),
  researchScore: real("research_score"),
  valuationScore: real("valuation_score"),
  categoryScoresJson: text("category_scores_json"),
  coverageJson: text("coverage_json"),
  evidenceJson: text("evidence_json"),
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
