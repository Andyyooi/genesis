import { and, desc, eq, gt, ne } from "drizzle-orm";
import { CalendarAgenda } from "@/components/calendar-agenda";
import { getDb } from "@/db/client";
import { loadDividendCoverage } from "@/db/dividends";
import { loadWatchlistMembership } from "@/db/queries";
import { companyCalendar, financialPeriods, instruments, priceBars } from "@/db/schema";
import { nextDividendDate } from "@/lib/company-calendar";
import { annualDividend } from "@/lib/holding-dividends";
import { loadLatestDatasetRefresh } from "@/refresh/persist";
import { malaysiaMarketDate } from "@/refresh/types";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  const today = malaysiaMarketDate();
  const watched = new Set(loadWatchlistMembership().map((row) => row.ticker));
  const db = getDb();
  const stocks = db.select({
    id: instruments.id,
    ticker: instruments.ticker,
    name: instruments.name,
    dates: companyCalendar,
  }).from(instruments)
    .leftJoin(companyCalendar, eq(companyCalendar.instrumentId, instruments.id))
    .where(ne(instruments.listingStatus, "inactive"))
    .all().map(({ id, ...row }) => {
      const upcoming = row.dates && nextDividendDate(row.dates.exDate, row.dates.paymentDate, today);
      const price = upcoming ? db.select({ date: priceBars.barDate, close: priceBars.close }).from(priceBars)
        .where(and(eq(priceBars.instrumentId, id), gt(priceBars.close, 0)))
        .orderBy(desc(priceBars.barDate)).limit(1).get() : null;
      const dividend = price ? annualDividend(
        db.select().from(financialPeriods)
          .where(and(eq(financialPeriods.instrumentId, id), eq(financialPeriods.statementType, "annual"))).all(),
        price.date, loadDividendCoverage(id),
      ) : null;
      return {
        ...row,
        watchlist: watched.has(row.ticker),
        yield: price?.close && dividend ? { percent: 100 * dividend.perShare / price.close, basis: dividend.label } : null,
      };
    });
  const checkedAt = stocks.flatMap(({ dates }) => dates ? [dates.checkedAt] : []).sort().at(-1);
  const refresh = loadLatestDatasetRefresh("calendar");

  return (
    <main className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="section-kicker mb-2">COMPANY CALENDAR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dividends and results dates</h1>
        <p className="mt-2 text-muted-foreground">See when companies plan to pay dividends or release their financial results.</p>
      </header>
      <CalendarAgenda
        stocks={stocks}
        today={today}
        checkedOn={checkedAt ? malaysiaMarketDate(new Date(checkedAt)) : null}
        incomplete={refresh?.status === "SOURCE_FAILED" || refresh?.status === "PARTIAL"}
      />
    </main>
  );
}
