import { eq, ne } from "drizzle-orm";
import { CalendarAgenda } from "@/components/calendar-agenda";
import { getDb } from "@/db/client";
import { companyCalendar, instruments } from "@/db/schema";
import { loadLatestDatasetRefresh } from "@/refresh/persist";
import { malaysiaMarketDate } from "@/refresh/types";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  const today = malaysiaMarketDate();
  const stocks = getDb().select({
    ticker: instruments.ticker,
    name: instruments.name,
    watchlist: instruments.watchlist,
    dates: companyCalendar,
  }).from(instruments)
    .leftJoin(companyCalendar, eq(companyCalendar.instrumentId, instruments.id))
    .where(ne(instruments.listingStatus, "inactive"))
    .all();
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
