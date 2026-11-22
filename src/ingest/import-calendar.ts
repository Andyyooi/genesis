import { ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companyCalendar, dividendAnnouncements, instruments } from "@/db/schema";
import { refuseSnapshotWrites } from "@/lib/data-mode";
import { i3Dividends, type DividendAnnouncementSource } from "@/providers/i3-dividends";
import { parseYahooCalendarQuote, yahooCalendarSource, type CalendarSource } from "@/providers/yahoo-calendar";
import { yahooSymbolCandidates } from "@/providers/yahoo-symbol-map";

export async function importCompanyCalendar(
  marketDate: string,
  checkedAt: string,
  source: CalendarSource = yahooCalendarSource(),
  announcementSource: DividendAnnouncementSource = i3Dividends,
) {
  if (refuseSnapshotWrites("calendar refresh")) throw new Error("Calendar refresh needs a writable database");
  const db = getDb();
  const listed = db.select().from(instruments).where(ne(instruments.listingStatus, "inactive")).all();
  const targets = listed.flatMap((instrument) => {
    const symbol = yahooSymbolCandidates(instrument)[0];
    return symbol ? [{ id: instrument.id, symbol }] : [];
  });
  const report = { attempted: 0, updated: 0, failed: 0, unavailable: listed.length - targets.length, error: null as string | null, announcements: 0 };
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
  try {
    const { saved, error } = await importDividendAnnouncements(listed, marketDate, checkedAt, announcementSource);
    report.announcements = saved;
    if (error) report.error = [report.error, error].filter(Boolean).join("; ");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    report.error = [report.error, detail].filter(Boolean).join("; ");
  }
  return report;
}

async function importDividendAnnouncements(
  listed: { id: number; bursaCode: string | null }[],
  today: string,
  checkedAt: string,
  source: DividendAnnouncementSource,
) {
  const db = getDb();
  const byCode = new Map(listed.map(({ id, bursaCode }) => [bursaCode, id]));
  const existing = new Map(db.select().from(dividendAnnouncements).all().map((row) => [row.sourceId, row]));
  const earliest = new Date(Date.parse(today) - 60 * 86400_000).toISOString().slice(0, 10);
  const recheck = new Date(Date.parse(checkedAt) - 7 * 86400_000).toISOString();
  const seen = new Set<string>();
  let saved = 0;
  let detailFailed = false;
  let listingError: string | null = null;
  let page: number | null = 1;
  while (page !== null && page <= 5) {
    const currentPage: number = page;
    let listing: Awaited<ReturnType<DividendAnnouncementSource["list"]>>;
    try {
      listing = await source.list(currentPage);
    } catch (error) {
      listingError = error instanceof Error ? error.message : String(error);
      break;
    }
    const { entries, next } = listing;
    const targets = entries.filter((entry) => {
      if (!byCode.has(entry.bursaCode) || entry.exDate < earliest || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
    for (let offset = 0; offset < targets.length; offset += 5) {
      await Promise.all(targets.slice(offset, offset + 5).map(async ({ id, bursaCode, exDate, amountMyr }) => {
        const instrumentId = byCode.get(bursaCode)!;
        const old = existing.get(id);
        const matchesOld = old?.instrumentId === instrumentId && old.exDate === exDate;
        if (matchesOld && old.checkedAt > recheck && old.amountMyr === amountMyr && old.paymentDate) return;
        let paymentDate = matchesOld ? old.paymentDate : null;
        let fetchedAt = checkedAt;
        try {
          const payment = await source.payment(id, exDate);
          if (payment === null && paymentDate !== null) {
            detailFailed = true;
            fetchedAt = old!.checkedAt;
          } else {
            paymentDate = payment;
          }
        } catch {
          detailFailed = true;
          if (matchesOld) fetchedAt = old.checkedAt;
        }
        if (exDate < today && (!paymentDate || paymentDate < today) && !old) return;
        const row = { sourceId: id, instrumentId, exDate, paymentDate, amountMyr, checkedAt: fetchedAt };
        db.insert(dividendAnnouncements).values(row).onConflictDoUpdate({
          target: dividendAnnouncements.sourceId,
          set: row,
        }).run();
        saved++;
      }));
    }
    page = next !== null && next > currentPage ? next : null;
  }
  const error = [listingError, detailFailed && "Some dividend payment dates could not be checked"].filter(Boolean).join("; ");
  return { saved, error };
}
