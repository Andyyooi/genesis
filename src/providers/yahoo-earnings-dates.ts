import { isoDay } from "@/db/point-in-time";

export type EarningsReportedDate = {
  periodEnd: string;
  reportedDate: string;
  fiscalQuarter: string | null;
};

type YahooFmt = { raw?: number; fmt?: string };

type EarningsChartQuarter = {
  date?: string;
  fiscalQuarter?: string;
  periodEndDate?: YahooFmt;
  reportedDate?: YahooFmt;
};

export type YahooEarningsResult = {
  earnings?: { earningsChart?: { quarterly?: EarningsChartQuarter[] } };
};

export type YahooEarningsChartJson = {
  quoteSummary?: {
    result?: YahooEarningsResult[];
  };
};

function unwrapEarningsResult(json: YahooEarningsChartJson | YahooEarningsResult): YahooEarningsResult | undefined {
  if ("earnings" in json) return json;
  return (json as YahooEarningsChartJson).quoteSummary?.result?.[0];
}

/** Yahoo earnings print date for a quarter. Not a Bursa announcement id. */
export function parseYahooEarningsChart(json: YahooEarningsChartJson | YahooEarningsResult): EarningsReportedDate[] {
  const result = unwrapEarningsResult(json);
  const quarters = result?.earnings?.earningsChart?.quarterly ?? [];
  const out: EarningsReportedDate[] = [];
  for (const row of quarters) {
    const periodEnd = isoDay(row.periodEndDate?.fmt ?? null);
    const reportedDate = isoDay(row.reportedDate?.fmt ?? null);
    if (!periodEnd || !reportedDate) continue;
    out.push({
      periodEnd,
      reportedDate,
      fiscalQuarter: row.fiscalQuarter ?? row.date ?? null,
    });
  }
  return out;
}

/**
 * Attach a report date to an annual only when Yahoo's quarter period-end matches exactly.
 * Skip dates on/before period-end or after the ingest clock (scheduled, not published).
 */
export function matchReportedDateForPeriod(args: {
  periodEnd: string;
  dates: EarningsReportedDate[];
  ingestDay: string;
}): EarningsReportedDate | null {
  const periodEnd = isoDay(args.periodEnd);
  const ingestDay = isoDay(args.ingestDay);
  if (!periodEnd || !ingestDay) return null;
  const hits = args.dates.filter((row) => row.periodEnd === periodEnd);
  if (hits.length !== 1) return hits.length === 0 ? null : null;
  const hit = hits[0];
  if (hit.reportedDate <= periodEnd) return null;
  if (hit.reportedDate > ingestDay) return null;
  return hit;
}
