import { ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companyCalendar, instruments } from "@/db/schema";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { parseYahooCalendarQuote, yahooCalendarSource, type CalendarSource } from "@/providers/yahoo-calendar";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";

export async function importCompanyCalendar(
  marketDate: string,
  checkedAt: string,
  source: CalendarSource = yahooCalendarSource(),
) {
  if (refuseSnapshotWrites("calendar refresh")) throw new Error("Calendar refresh needs a writable database");
  const db = getDb();
  const listed = db.select().from(instruments).where(ne(instruments.listingStatus, "inactive")).all();
  const targets = listed.flatMap((instrument) => {
    const symbol = yahooSymbolCandidates(instrument)[0];
    return symbol ? [{ id: instrument.id, symbol }] : [];
  });
  const report = { attempted: 0, updated: 0, failed: 0, unavailable: listed.length - targets.length, error: null as string | null };
  const existing = new Map(db.select().from(companyCalendar).all().map((row) => [row.instrumentId, row]));
  for (let offset = 0; offset < targets.length; offset += 50) {
    const batch = targets.slice(offset, offset + 50);
    report.attempted += batch.length;
    const accounted = report.updated + report.unavailable;
    try {
      const quotes = new Map((await source.quotes([...new Set(batch.map((row) => row.symbol))])).map((quote) => [quote.symbol, quote]));
      for (const { id, symbol } of batch) {
        const quote = quotes.get(symbol);
        if (!quote) {
          report.unavailable++;
          continue;
        }
        const dates = parseYahooCalendarQuote(quote);
        const old = existing.get(id);
        const sameDividend = old?.yahooSymbol === symbol && old.exDate === dates.exDate;
        let dividendAmount = sameDividend ? old.dividendAmount : null;
        let dividendCurrency = sameDividend ? old.dividendCurrency : null;
        if (dividendAmount === null && dates.exDate &&
          (dates.exDate >= marketDate || (dates.paymentDate && dates.paymentDate >= marketDate))) {
          try {
            const dividend = await source.dividend(symbol, dates.exDate);
            if (dividend) ({ amount: dividendAmount, currency: dividendCurrency } = dividend);
          } catch {
            // Chart coverage is optional; the quote still supplies independently usable dates.
          }
        }
        const row = { instrumentId: id, yahooSymbol: symbol, checkedAt, ...dates, dividendAmount, dividendCurrency };
        db.insert(companyCalendar).values(row).onConflictDoUpdate({
          target: companyCalendar.instrumentId,
          set: row,
        }).run();
        report.updated++;
      }
    } catch (error) {
      report.failed = batch.length - (report.updated + report.unavailable - accounted);
      report.error = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  return report;
}
