import Link from "next/link";
import { loadLatestMarketScan } from "@/market/scan";
import { formatScore100 } from "@/lib/research-copy";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function MarketPage() {
  const { summary, rows } = loadLatestMarketScan();
  const dq = summary?.dataQuality;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Dashboard
        </Link>
        {" · market scan · research lists, not buy orders"}
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Market scan</h1>
        <p className="max-w-3xl text-muted-foreground">
          Last <code className="font-mono text-sm">npm run market:scan</code> snapshot. Universe comes
          from the Yahoo Malaysia equity screener (COMMON_STOCK + REIT). Warrants/ETFs excluded.
          Missing filings stay unavailable.
        </p>
      </header>

      {!summary ? (
        <p className="text-sm text-muted-foreground">
          No scan stored yet. Run <code className="font-mono">npm run market:scan</code> on this
          machine (Yahoo rate limits; several minutes). That is not Cursor usage.
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Listed names" value={String(dq?.instruments ?? "—")} />
            <Stat label="With prices" value={String(dq?.withPrices ?? "—")} />
            <Stat label="With fundamentals" value={String(dq?.withFundamentals ?? "—")} />
            <Stat
              label="Insufficient data"
              value={String(summary.scores.insufficient)}
            />
          </section>
          <p className="text-sm text-muted-foreground">
            REITs {dq?.reits ?? 0} · PN17 {dq?.pn17 ?? 0} · price misses {summary.prices.failed} ·
            Yahoo statement misses {summary.fundamentalsYahoo.failed} · asOf {summary.asOf.slice(0, 19)}
          </p>

          <ScanTable
            title="Highest Research Score"
            rows={summary.highlights.highestResearch.map((r) => ({
              ticker: r.ticker,
              extra: formatScore100(r.score),
            }))}
          />
          <ScanTable
            title="Highest Valuation Score"
            rows={summary.highlights.highestValuation.map((r) => ({
              ticker: r.ticker,
              extra: formatScore100(r.score),
            }))}
          />
          <ScanTable
            title="Large discount vs 52-week high (≥15%)"
            rows={summary.highlights.largeMoves.map((r) => ({
              ticker: r.ticker,
              extra:
                r.distanceFrom52wHigh == null
                  ? "Data unavailable"
                  : `${(r.distanceFrom52wHigh * 100).toFixed(0)}% below high`,
            }))}
          />
          <ScanTable
            title="PN17 / higher-risk status"
            rows={summary.highlights.pn17.map((ticker) => ({ ticker, extra: "PN17 (not a score penalty)" }))}
            empty="None flagged in this universe snapshot."
          />
          <ScanTable
            title="Insufficient data (sample)"
            rows={summary.highlights.insufficientData.map((ticker) => ({
              ticker,
              extra: "Coverage too thin or no Research Score",
            }))}
          />

          <section>
            <h2 className="mb-2 text-xl font-semibold">All scored names</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Research</TableHead>
                    <TableHead className="text-right">Valuation</TableHead>
                    <TableHead className="text-right">Coverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((row) => (
                    <TableRow key={String(row.ticker)}>
                      <TableCell className="font-mono">
                        <Link href={`/stock/${row.ticker}`} className="underline underline-offset-4">
                          {String(row.ticker)}
                        </Link>
                        {row.pn17 ? (
                          <Badge className="ml-1" variant="destructive">
                            PN17
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{String(row.instrumentType)}</TableCell>
                      <TableCell className="text-right">
                        {formatScore100(typeof row.researchScore === "number" ? row.researchScore : null)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatScore100(typeof row.valuationScore === "number" ? row.valuationScore : null)}
                      </TableCell>
                      <TableCell className="text-right">
                        {typeof row.coverage === "number" ? `${(row.coverage * 100).toFixed(0)}%` : "Data unavailable"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > 200 ? (
              <p className="mt-2 text-sm text-muted-foreground">Showing 200 of {rows.length}.</p>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ScanTable({
  title,
  rows,
  empty = "None in this snapshot.",
}: {
  title: string;
  rows: { ticker: string; extra: string }[];
  empty?: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={title + row.ticker} className="flex justify-between gap-2 px-3 py-2 text-sm">
              <Link href={`/stock/${row.ticker}`} className="font-mono underline underline-offset-4">
                {row.ticker}
              </Link>
              <span className="text-muted-foreground">{row.extra}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
