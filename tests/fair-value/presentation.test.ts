import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { EstimatedFairValue } from "@/components/research/estimated-fair-value";
import { loadFairValueForPage } from "@/fair-value/load-for-page";
import type { FairValueAssumptions, FairValueMethodEvidence, FairValueResult } from "@/fair-value/types";
import {
  FAIR_VALUE_ONE_METHOD_RANGE,
  FAIR_VALUE_SECTION_DESCRIPTION,
  fairValueConfidenceText,
  fairValueDifferenceText,
  fairValueHeroText,
  fairValueInputLabel,
  fairValueMethodSummary,
  fairValuePresentationHasRecommendationLanguage,
  fairValuePriceUsedText,
  fairValueRangeText,
  fairValueSampleText,
  formatFairValueInput,
  formatFairValueMultiple,
} from "@/lib/fair-value-presentation";
import { formatMyr } from "@/lib/format-myr";

const PERIOD_END_LIMITATION =
  "Period-end price vs that period’s earnings, filing date unknown. This is not look-ahead-safe point-in-time P/E.";

const REIT_EXCLUSIONS =
  "P/E, distribution yield, DPU, reported NAV, FFO, AFFO, DCF, cap rates, and property-level valuation are not calculated. Equity / shares is accounting book value per share, not reported NAV.";

function assumptions(patch: Partial<FairValueAssumptions> = {}): FairValueAssumptions {
  return {
    modelVersion: "general-relative-v1",
    researchProfile: "GENERAL",
    modelDefaultsUsed: false,
    yamlScoreBandsUsed: false,
    peerGroupType: "INDUSTRY",
    peerSelectionPath: "Widgets - Industrial",
    peerEligibleCount: 8,
    peerUnavailableReason: null,
    historicalPointCount: 4,
    lookAheadSafe: false,
    historicalValuationStatus: "PERIOD_END_ONLY",
    historicalLimitation: PERIOD_END_LIMITATION,
    freshness: "FRESH",
    freshnessObservationDate: "2025-12-31",
    freshnessAgeMonths: 9,
    currentPriceDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    ...patch,
  };
}

function method(patch: Partial<FairValueMethodEvidence> & Pick<FairValueMethodEvidence, "id" | "label">): FairValueMethodEvidence {
  return {
    kind: "peer",
    available: true,
    methodValue: 10,
    formula: "EPS × peer median P/E",
    currentInput: 1,
    currentInputName: "eps",
    medianMultiple: 10,
    medianName: "peer_median_pe",
    sampleSize: 5,
    peerGroup: "Widgets - Industrial",
    peerCount: 5,
    historicalSampleCount: null,
    fundamentalsPeriodEnd: "2025-12-31",
    valuationDate: "2026-09-25",
    priceDates: null,
    historicalPeriodEnds: null,
    lookAheadSafe: false,
    unavailableReason: null,
    ...patch,
  };
}

function result(patch: Partial<FairValueResult> = {}): FairValueResult {
  const earnings = method({ id: "earnings_peer_pe", label: "Earnings × peer median P/E", methodValue: 12 });
  const book = method({
    id: "book_peer_pb",
    label: "Book value × peer median P/B",
    formula: "book value per share × peer median P/B",
    currentInput: 8,
    currentInputName: "book_value_per_share",
    medianMultiple: 1.25,
    medianName: "peer_median_pb",
    methodValue: 10,
  });
  return {
    ticker: "ACME",
    researchProfile: "GENERAL",
    modelVersion: "general-relative-v1",
    valuationDate: "2026-09-25",
    fundamentalsPeriodEnd: "2025-12-31",
    currentPrice: 11,
    fairValueLow: 10,
    fairValueBase: 11,
    fairValueHigh: 12,
    differenceVsPrice: 0,
    confidence: "MEDIUM",
    methods: [earnings, book],
    assumptions: assumptions(),
    unavailableReason: null,
    ...patch,
  };
}

function visibleCopy(value: FairValueResult): string {
  return [
    FAIR_VALUE_SECTION_DESCRIPTION,
    fairValueHeroText(value),
    fairValueRangeText(value) ?? "",
    fairValuePriceUsedText(value),
    fairValueDifferenceText(value.differenceVsPrice),
    fairValueConfidenceText(value),
    value.assumptions.historicalLimitation ?? "",
    value.assumptions.excludedApproaches ?? "",
    ...value.methods.map((item) => fairValueMethodSummary(item)),
    ...value.methods.map((item) => formatFairValueInput(item)),
    ...value.methods.map((item) => fairValueInputLabel(item)),
  ].join("\n");
}

describe("Fair Value presentation", () => {
  it("formats a finite base, range, and zero difference", () => {
    const value = result();
    expect(fairValueHeroText(value)).toBe(formatMyr(11));
    expect(fairValueRangeText(value)).toBe(`${formatMyr(10)} – ${formatMyr(12)}`);
    expect(fairValueDifferenceText(0)).toBe("At the current price");
    expect(fairValuePriceUsedText(value)).toContain(formatMyr(11));
    expect(fairValuePriceUsedText(value)).toContain("2026-09-25");
  });

  it("does not invent a range when only one method produced a value", () => {
    const value = result({
      fairValueLow: null,
      fairValueBase: 20,
      fairValueHigh: null,
      differenceVsPrice: (20 - 11) / 11,
      confidence: "LOW",
      methods: [method({ id: "earnings_peer_pe", label: "Earnings × peer median P/E", methodValue: 20 })],
    });
    expect(fairValueRangeText(value)).toBe(FAIR_VALUE_ONE_METHOD_RANGE);
    expect(fairValueRangeText(value)).not.toContain(formatMyr(20));
  });

  it("describes a positive difference as above the current price", () => {
    expect(fairValueDifferenceText(0.061)).toBe("6.1% above the current price");
  });

  it("describes a negative difference as below the current price", () => {
    expect(fairValueDifferenceText(-0.283)).toBe("28.3% below the current price");
  });

  it("explains HIGH, MEDIUM, LOW, and stale LOW confidence from the result", () => {
    expect(fairValueConfidenceText(result({ confidence: "HIGH" }))).toBe(
      "At least three methods are available, with sufficient supporting peer/history evidence.",
    );
    expect(fairValueConfidenceText(result({ confidence: "MEDIUM" }))).toBe(
      "More than one method is available, so the estimate is supported by a range of valuation methods.",
    );
    expect(fairValueConfidenceText(result({ confidence: "LOW" }))).toBe(
      "Only one valuation method is available, so there is no valuation range.",
    );
    expect(
      fairValueConfidenceText(
        result({
          confidence: "LOW",
          assumptions: assumptions({ freshness: "VERY_STALE" }),
        }),
      ),
    ).toBe("Fundamentals are VERY STALE, so confidence stays low.");
  });

  it("shows unavailable and unsupported states without a fabricated value", () => {
    const unavailable = result({
      modelVersion: "general-relative-v1",
      fairValueLow: null,
      fairValueBase: null,
      fairValueHigh: null,
      differenceVsPrice: null,
      confidence: "UNAVAILABLE",
      unavailableReason: "No supported valuation method produced a value.",
      methods: [
        method({
          id: "earnings_history_pe",
          label: "Earnings × own historical median P/E",
          available: false,
          methodValue: null,
          unavailableReason: "Historical P/E sample is 2, need 3 finite values above zero.",
        }),
      ],
    });
    expect(fairValueHeroText(unavailable)).toBe("Unavailable");
    expect(fairValueRangeText(unavailable)).toBeNull();
    expect(fairValueConfidenceText(unavailable)).toBe("No supported valuation method produced a value.");
    expect(fairValueMethodSummary(unavailable.methods[0]!)).toContain("Historical P/E sample is 2");

    const unsupported = result({
      researchProfile: "OTHER_FINANCIAL",
      modelVersion: "unsupported",
      currentPrice: null,
      valuationDate: null,
      fairValueLow: null,
      fairValueBase: null,
      fairValueHigh: null,
      differenceVsPrice: null,
      confidence: "UNAVAILABLE",
      methods: [],
      unavailableReason: "No Fair Value model exists for research profile OTHER_FINANCIAL.",
      assumptions: assumptions({
        modelVersion: "unsupported",
        researchProfile: "OTHER_FINANCIAL",
        peerGroupType: null,
        peerSelectionPath: null,
        historicalLimitation: null,
        freshness: "UNKNOWN",
      }),
    });
    expect(fairValueHeroText(unsupported)).toBe("Unavailable");
    expect(fairValuePriceUsedText(unsupported)).toBe("Unavailable");
    expect(fairValueDifferenceText(unsupported.differenceVsPrice)).toBe("Unavailable");
    expect(fairValueConfidenceText(unsupported)).toContain("OTHER_FINANCIAL");
    expect(unsupported.methods).toEqual([]);
  });

  it("keeps the difference unavailable when the model price is missing", () => {
    const value = result({
      currentPrice: null,
      valuationDate: null,
      differenceVsPrice: null,
      fairValueBase: 10,
      fairValueLow: null,
      fairValueHigh: null,
    });
    expect(fairValueHeroText(value)).toBe(formatMyr(10));
    expect(fairValuePriceUsedText(value)).toBe("Unavailable");
    expect(fairValueDifferenceText(value.differenceVsPrice)).toBe("Unavailable");
  });

  it("discloses the stored historical limitation and REIT exclusions", () => {
    const value = result({
      researchProfile: "REIT",
      modelVersion: "reit-relative-v1",
      assumptions: assumptions({
        modelVersion: "reit-relative-v1",
        researchProfile: "REIT",
        excludedApproaches: REIT_EXCLUSIONS,
      }),
      methods: [
        method({
          id: "book_peer_pb",
          label: "Accounting book × peer median P/B",
          formula: "book value per share × peer median P/B",
          currentInputName: "book_value_per_share",
          currentInput: 1.45,
          medianMultiple: 0.687,
          methodValue: 1,
        }),
      ],
    });
    expect(value.assumptions.historicalLimitation).toContain("not look-ahead-safe");
    expect(value.assumptions.excludedApproaches).toContain("reported NAV");
    expect(fairValueInputLabel(value.methods[0]!)).toBe("Book value per share");
    expect(fairValueInputLabel(value.methods[0]!)).not.toMatch(/NAV/);
    expect(fairValueMethodSummary(value.methods[0]!)).toContain("Accounting book × peer median P/B");
    expect(formatFairValueMultiple(value.methods[0]!)).toBe("0.69x");
  });

  it("formats dividend yield as a percentage and uses the method that was returned", () => {
    const yieldMethod = method({
      id: "dividend_peer_yield",
      label: "DPS ÷ peer median dividend yield",
      kind: "peer",
      formula: "DPS / peer median dividend yield",
      currentInputName: "dividend_per_share",
      currentInput: 0.5,
      medianMultiple: 0.04,
      methodValue: 12.5,
    });
    const historyMethod = method({
      id: "book_history_pb",
      label: "Book value × own historical median P/B",
      kind: "history",
      available: false,
      methodValue: null,
      currentInputName: "book_value_per_share",
      medianMultiple: null,
      peerCount: null,
      historicalSampleCount: 2,
      historicalPeriodEnds: ["2024-12-31", "2025-12-31"],
      unavailableReason: "Historical P/B sample is 2, need 3 finite values above zero.",
    });
    expect(formatFairValueMultiple(yieldMethod)).toBe("4.00%");
    expect(formatFairValueInput(yieldMethod)).toBe("Dividend per share: 0.5000");
    expect(fairValueSampleText(yieldMethod)).toContain("5 peers");
    expect(fairValueSampleText(historyMethod)).toContain("2 observations");
    expect(fairValueSampleText(historyMethod)).toContain("2024-12-31");
    expect(fairValueMethodSummary(yieldMethod)).toBe(
      `DPS ÷ peer median dividend yield → ${formatMyr(12.5)}`,
    );
    const markup = renderToStaticMarkup(
      createElement(EstimatedFairValue, {
        result: result({
          methods: [yieldMethod, historyMethod],
          fairValueBase: 12.5,
          fairValueLow: null,
          fairValueHigh: null,
          confidence: "LOW",
        }),
      }),
    );
    expect(markup).toContain("DPS ÷ peer median dividend yield");
    expect(markup).toContain("Unavailable · 1");
    expect(markup).not.toContain("Earnings × peer median P/E");
    expect(fairValueMethodSummary(historyMethod)).toContain("Book value × own historical median P/B");
    expect(markup).toContain(PERIOD_END_LIMITATION);
    expect(markup).toContain("Model general-relative-v1");
  });

  it("does not generate recommendation language", () => {
    const copies = [
      result(),
      result({ differenceVsPrice: 0.5, confidence: "HIGH" }),
      result({ differenceVsPrice: -0.283, confidence: "LOW", assumptions: assumptions({ freshness: "STALE" }) }),
      result({
        modelVersion: "unsupported",
        confidence: "UNAVAILABLE",
        fairValueBase: null,
        fairValueLow: null,
        fairValueHigh: null,
        differenceVsPrice: null,
        methods: [],
        unavailableReason: "No Fair Value model exists for research profile UNKNOWN.",
      }),
    ];
    for (const value of copies) {
      expect(fairValuePresentationHasRecommendationLanguage(visibleCopy(value))).toBe(false);
    }
    const source = readFileSync("src/components/research/estimated-fair-value.tsx", "utf8");
    expect(fairValuePresentationHasRecommendationLanguage(source)).toBe(false);
    expect(source).not.toMatch(/NAV/);
  });
});

describe("Fair Value page loader", () => {
  it("reads a stored name through the orchestrator and does not persist a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "fv-page-"));
    const dbPath = join(dir, "research.db");
    const setup = new Database(dbPath);
    setup.exec(`
      CREATE TABLE instruments (
        id INTEGER PRIMARY KEY,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        sector TEXT,
        industry TEXT,
        instrument_type TEXT NOT NULL,
        research_profile TEXT,
        listing_status TEXT NOT NULL DEFAULT 'listed'
      );
      CREATE TABLE price_bars (
        id INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL,
        bar_date TEXT NOT NULL,
        close REAL,
        high REAL,
        low REAL
      );
      CREATE TABLE financial_periods (
        id INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL,
        period_end TEXT NOT NULL,
        available_at TEXT,
        statement_type TEXT NOT NULL,
        source TEXT NOT NULL,
        fiscal_quarter INTEGER,
        line_items_json TEXT
      );
      CREATE TABLE fair_value_runs (
        id INTEGER PRIMARY KEY,
        ticker TEXT NOT NULL
      );
    `);
    const insertInstrument = setup.prepare(
      `INSERT INTO instruments (ticker, name, sector, industry, instrument_type, research_profile, listing_status)
       VALUES (?, ?, ?, ?, ?, ?, 'listed')`,
    );
    const insertPeriod = setup.prepare(
      `INSERT INTO financial_periods (instrument_id, period_end, available_at, statement_type, source, fiscal_quarter, line_items_json)
       VALUES (?, '2025-12-31', NULL, 'annual', 'fixture', NULL, ?)`,
    );
    const insertBar = setup.prepare(
      `INSERT INTO price_bars (instrument_id, bar_date, close, high, low) VALUES (?, '2026-09-25', ?, NULL, NULL)`,
    );
    const subject = Number(
      insertInstrument.run("ACME", "Acme", "Industrials", "Widgets - Industrial", "COMMON_STOCK", "GENERAL").lastInsertRowid,
    );
    insertPeriod.run(subject, JSON.stringify({ eps: 2, equity: 100, shares: 10, revenue: 100, pat: 10 }));
    insertBar.run(subject, 11);
    for (let i = 1; i <= 5; i += 1) {
      const id = Number(
        insertInstrument.run(`P${i}`, `Peer ${i}`, "Industrials", "Widgets - Industrial", "COMMON_STOCK", "GENERAL")
          .lastInsertRowid,
      );
      insertPeriod.run(id, JSON.stringify({ eps: 1, equity: 50, shares: 10, revenue: 100, pat: 10 }));
      insertBar.run(id, 10);
    }
    const insurer = Number(
      insertInstrument.run("INSURE", "Insure", "Financial Services", "Asset Management", "COMMON_STOCK", "OTHER_FINANCIAL")
        .lastInsertRowid,
    );
    insertPeriod.run(insurer, JSON.stringify({ eps: 2, equity: 100, shares: 10 }));
    insertBar.run(insurer, 11);
    setup.close();

    const previous = process.env.BURSA_SQLITE_PATH;
    process.env.BURSA_SQLITE_PATH = dbPath;
    try {
      const general = loadFairValueForPage("ACME", "2026-09-28T00:00:00.000Z");
      const other = loadFairValueForPage("insure", "2026-09-28T00:00:00.000Z");
      expect(general?.modelVersion).toBe("general-relative-v1");
      expect(general?.researchProfile).toBe("GENERAL");
      expect(general?.fairValueBase).toBe(20);
      expect(general?.methods.some((item) => item.available)).toBe(true);
      expect(other?.modelVersion).toBe("unsupported");
      expect(other?.confidence).toBe("UNAVAILABLE");
      expect(other?.methods).toEqual([]);
      expect(other?.fairValueBase).toBeNull();
      const check = new Database(dbPath, { readonly: true, fileMustExist: true });
      const runs = (check.prepare("select count(*) as n from fair_value_runs").get() as { n: number }).n;
      const profile = (
        check.prepare("select research_profile as researchProfile from instruments where ticker = 'INSURE'").get() as {
          researchProfile: string;
        }
      ).researchProfile;
      check.close();
      expect(runs).toBe(0);
      expect(profile).toBe("OTHER_FINANCIAL");
    } finally {
      if (previous === undefined) delete process.env.BURSA_SQLITE_PATH;
      else process.env.BURSA_SQLITE_PATH = previous;
    }
  });

  it("does not persist, score, or call the profile calculators directly", () => {
    const loader = readFileSync("src/fair-value/load-for-page.ts", "utf8");
    const page = readFileSync("src/app/stock/[ticker]/page.tsx", "utf8");
    const presentation = readFileSync("src/lib/fair-value-presentation.ts", "utf8");
    expect(loader).toContain("calculateFairValue");
    expect(loader).toContain("readonly: true");
    expect(loader).not.toMatch(/persistFairValueRun|insertFairValueRun|scoreTicker|calculateGeneralFairValue|calculateBankFairValue|calculateReitFairValue|yahoo|fetch\(/);
    expect(presentation).not.toMatch(/calculateFairValue|persistFairValueRun|scoreTicker/);
    expect(page).toContain("loadFairValueForPage");
    expect(page).toContain("<EstimatedFairValue");
    expect(page.indexOf("Absolute Valuation")).toBeLessThan(page.indexOf("<EstimatedFairValue"));
    expect(page.indexOf("<EstimatedFairValue")).toBeLessThan(page.indexOf("Profile metrics"));
    expect(page).not.toMatch(/calculateFairValue|calculateGeneralFairValue|persistFairValueRun/);
    expect(readFileSync("src/fair-value/orchestrate.ts", "utf8")).toContain("export function calculateFairValue");
    expect(readFileSync("src/fair-value/calculate.ts", "utf8")).not.toContain("EstimatedFairValue");
  });
});
