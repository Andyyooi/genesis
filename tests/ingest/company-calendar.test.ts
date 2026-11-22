import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/client";
import { companyCalendar, dividendAnnouncements, instruments } from "@/db/schema";
import { importCompanyCalendar } from "@/ingest/import-calendar";
import { calendarAgenda, type CalendarStock } from "@/lib/company-calendar";
import { parseDividendList, parseDividendPayment } from "@/providers/i3-dividends";
import { parseYahooCalendarQuote, parseYahooDividend } from "@/providers/yahoo-calendar";

const today = "2026-11-22";
const now = today + "T00:00:00.000Z";
const exDate = "2026-11-20";
const paymentDate = "2026-12-02";
const resultsDate = "2026-11-24";
const seconds = (date: string) => Date.parse(date) / 1000;

afterEach(() => {
  const globalDb = globalThis as { sqlite?: { close(): void } };
  globalDb.sqlite?.close();
  delete globalDb.sqlite;
  vi.unstubAllEnvs();
});

describe("company calendar", () => {
  it("keeps Yahoo estimates and date ranges distinct and does not use an annual rate as cash per share", () => {
    expect(parseYahooCalendarQuote({
      symbol: "1155.KL",
      earningsTimestamp: seconds(resultsDate),
      earningsTimestampStart: seconds(resultsDate),
      earningsTimestampEnd: seconds("2026-11-27"),
      isEarningsDateEstimate: false,
      exDividendDate: seconds(exDate),
      dividendDate: seconds("2026-11-01"),
      dividendYield: 6.28,
    })).toEqual({
      resultsFrom: resultsDate, resultsThrough: "2026-11-27", resultsEstimated: true,
      exDate, paymentDate: null, annualYieldPercent: 6.28,
    });
    expect(parseYahooCalendarQuote({ symbol: "1155.KL", earningsTimestamp: seconds(resultsDate), isEarningsDateEstimate: false }))
      .toMatchObject({ resultsFrom: resultsDate, resultsThrough: resultsDate, resultsEstimated: false });
    expect(parseYahooCalendarQuote({ symbol: "1155.KL" }))
      .toMatchObject({ resultsFrom: null, exDate: null, paymentDate: null, annualYieldPercent: null });
    const chart = { chart: { result: [{ meta: { currency: "MYR" }, events: { dividends: { a: { date: seconds(exDate), amount: 0.12 } } } }] } };
    expect(parseYahooDividend(chart, exDate)).toEqual({ amount: 0.12, currency: "MYR" });
    expect(parseYahooDividend(chart, resultsDate)).toBeNull();
  });

  it("reads announcement rows by Bursa code and only pairs a payment with its own ex-date", () => {
    const html = `<table><tr><th>Ann. Date</th><th>Ex Date</th></tr>
      <tr><td>10-Nov-2026</td><td><a href="/web/stock/entitlement/0246">EXAMPLE</a></td>
      <td>0.71</td><td>0.695</td><td>RM 0.0100</td><td>20-Nov-2026</td>
      <td><a href="/web/entitlement/detail/123_456">Details</a></td></tr></table>
      <a rel="next" href="/web/entitlement/dividend/latest?page=2">Next</a>`;
    expect(parseDividendList(html)).toEqual({ entries: [{ bursaCode: "0246", id: "123_456", exDate, amountMyr: 0.01 }], next: 2 });
    expect(() => parseDividendList("<h1>Temporarily unavailable</h1>")).toThrow("Dividend listing was unavailable");
    const detail = '<div class="step">Ex Date</div><div class="date">20-Nov-2026</div><div>Payment Date</div><div>02-Dec-2026</div>';
    expect(parseDividendPayment(detail, exDate)).toBe(paymentDate);
    expect(parseDividendPayment(detail, today)).toBeNull();
  });

  it("keeps the prior payment date and check time when a detail recheck returns no date", async () => {
    vi.stubEnv("BURSA_SQLITE_PATH", ":memory:");
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
    const db = getDb();
    db.insert(instruments).values({
      ticker: "MAYBANK", bursaCode: "1155", name: "Maybank", instrumentType: "COMMON_STOCK", createdAt: now, updatedAt: now,
    }).run();
    const quote = { quotes: async () => [{ symbol: "1155.KL" }], dividend: async () => null };
    const list = async () => ({ entries: [{ id: "123_456", bursaCode: "1155", exDate, amountMyr: 0.01 }], next: null });
    const earlier = "2026-11-14T00:00:00.000Z";
    await importCompanyCalendar("2026-11-14", earlier, quote, { list, payment: async () => paymentDate });

    const report = await importCompanyCalendar(today, now, quote, {
      list, payment: async () => parseDividendPayment("<h1>Temporarily unavailable</h1>", exDate),
    });

    expect(report.error).toBe("Some dividend payment dates could not be checked");
    expect(db.select().from(dividendAnnouncements).get()).toMatchObject({ paymentDate, checkedAt: earlier });
  });

  it("stores both sources, preserves saved dates on failure, and limits the agenda to the selected stocks and upcoming dates", async () => {
    vi.stubEnv("BURSA_SQLITE_PATH", ":memory:");
    vi.stubEnv("VERCEL", "0");
    vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
    const db = getDb();
    db.insert(instruments).values([
      { ticker: "MAYBANK", bursaCode: "1155", name: "Maybank", watchlist: true },
      { ticker: "OTHER", bursaCode: "0001", name: "Other", watchlist: false },
      { ticker: "OLD", bursaCode: "0002", name: "Old", listingStatus: "inactive" },
    ].map((row) => ({ ...row, createdAt: now, updatedAt: now, instrumentType: "COMMON_STOCK" as const }))).run();
    const quotes = vi.fn(async () => [
      { symbol: "1155.KL", earningsTimestamp: seconds(resultsDate), exDividendDate: seconds(exDate), dividendDate: seconds(paymentDate), dividendYield: 6.28 },
      { symbol: "0001.KL", earningsTimestamp: seconds(exDate) },
    ]);
    const source = { quotes, dividend: async () => null };
    const supplement = {
      list: async () => ({
        entries: [
          { id: "123_456", bursaCode: "1155", exDate, amountMyr: 0.01 },
          { id: "123_457", bursaCode: "1155", exDate, amountMyr: 0.02 },
        ],
        next: null,
      }),
      payment: async () => paymentDate,
    };
    expect(await importCompanyCalendar(today, now, source, supplement))
      .toMatchObject({ attempted: 2, updated: 2, failed: 0, announcements: 2, error: null });
    expect(quotes).toHaveBeenCalledWith(["1155.KL", "0001.KL"]);
    const fail = async () => { throw new Error("source offline"); };
    expect(await importCompanyCalendar(today, now, { ...source, quotes: fail }, { ...supplement, list: fail }))
      .toMatchObject({ updated: 0, failed: 2 });
    const stocks: CalendarStock[] = db.select().from(instruments).all().map((stock) => ({
      ...stock,
      dates: db.select().from(companyCalendar).all().find((row) => row.instrumentId === stock.id) ?? null,
      announcedDividends: db.select().from(dividendAnnouncements).all().filter((row) => row.instrumentId === stock.id),
    }));
    const all = calendarAgenda(stocks, "all", new Set(), today);
    expect(all.results.map((row) => row.ticker)).toEqual(["MAYBANK"]);
    expect(all.dividends.map((row) => [row.sortDate, row.dividendAmount])).toEqual([[paymentDate, 0.01], [paymentDate, 0.02]]);
    expect(calendarAgenda(stocks, "holdings", new Set(["OTHER"]), today)).toEqual({ results: [], dividends: [] });
    expect(calendarAgenda(stocks, "watchlist", new Set(["OTHER"]), today)).toEqual(all);
    expect(calendarAgenda(stocks, "all", new Set(), "2026-12-03")).toEqual({ results: [], dividends: [] });
  });
});
