import { eq, gte, ne, or } from "drizzle-orm";
import { CalendarAgenda } from "@/components/calendar-agenda";
import { getDb } from "@/db/client";
import { companyCalendar, dividendAnnouncements, instruments } from "@/db/schema";
import { loadLatestDatasetRefresh } from "@/refresh/persist";
import { malaysiaMarketDate } from "@/refresh/types";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  const db = getDb();
  const today = malaysiaMarketDate();
  const announcements = db.select().from(dividendAnnouncements)
    .where(or(gte(dividendAnnouncements.exDate, today), gte(dividendAnnouncements.paymentDate, today)))
    .all();
  const byInstrument = new Map<number, typeof announcements>();
  for (const announcement of announcements) {
    const existing = byInstrument.get(announcement.instrumentId);
    if (existing) existing.push(announcement);
    else byInstrument.set(announcement.instrumentId, [announcement]);
  }
  const stocks = db.select({
    instrumentId: instruments.id,
    ticker: instruments.ticker,
    name: instruments.name,
    watchlist: instruments.watchlist,
    dates: companyCalendar,
  }).from(instruments)
    .leftJoin(companyCalendar, eq(companyCalendar.instrumentId, instruments.id))
    .where(ne(instruments.listingStatus, "inactive"))
    .all();
  const checkedAt = [
    ...stocks.flatMap(({ dates }) => dates ? [dates.checkedAt] : []),
    ...announcements.map((row) => row.checkedAt),
  ].sort().at(-1);
  const refresh = loadLatestDatasetRefresh("calendar");

  return (
    <main className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="section-kicker mb-2">COMPANY CALENDAR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Dividends and results dates</h1>
        <p className="mt-2 text-muted-foreground">See when companies plan to pay dividends or release their financial results.</p>
      </header>
      <CalendarAgenda
        stocks={stocks.map(({ instrumentId, ...stock }) => ({ ...stock, announcedDividends: byInstrument.get(instrumentId) }))}
        today={today}
        checkedOn={checkedAt ? malaysiaMarketDate(new Date(checkedAt)) : null}
        incomplete={refresh?.status === "SOURCE_FAILED" || refresh?.status === "PARTIAL"}
      />
    </main>
  );
}
