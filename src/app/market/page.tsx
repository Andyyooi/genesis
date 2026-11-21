import Link from "next/link";
import { loadLatestFundamentalsQuality } from "@/market/fundamentals-quality";
import { loadLatestMarketScan } from "@/market/scan";
import { filterMarketRows } from "@/market/filters";
import { isSnapshotReadOnly } from "@/lib/data-mode";
import { dataConfidenceLabel, formatScore100 } from "@/lib/research-copy";
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

export default async function MarketPage({ searchParams }: PageProps<"/market">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const eligibility = typeof params.eligibility === "string" ? params.eligibility : "";
  const { summary, rows } = loadLatestMarketScan();
  const visible = filterMarketRows(rows, q, eligibility);
  const quality = loadLatestFundamentalsQuality();
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
          {isSnapshotReadOnly()
            ? "Last stored market scan from the bundled snapshot. npm run market:scan cannot write on Vercel."
            : "Last npm run market:scan snapshot. Universe comes from the Yahoo Malaysia equity screener (COMMON_STOCK + REIT). Warrants/ETFs excluded. Missing filings stay unavailable."}
        </p>
      </header>

      {quality ? (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Fundamentals data quality</h2>
          <p className="text-sm text-muted-foreground">
            Latest annual per listed name. Full = revenue, PAT, and equity present. Partial = at least
            one of those. Age uses period-end or filing date, not download time. Run{" "}
            <code className="font-mono">npm run fundamentals:report</code>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Usable (full+partial)" value={String(quality.coverage.usable)} />
            <Stat label="Full (rev+PAT+equity)" value={String(quality.coverage.full)} />
            <Stat label="Partial" value={String(quality.coverage.partial)} />
            <Stat label="None" value={String(quality.coverage.none)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Fresh {quality.freshness.FRESH ?? 0} · aging {quality.freshness.AGING ?? 0} · stale{" "}
            {quality.freshness.STALE ?? 0} · very stale {quality.freshness.VERY_STALE ?? 0} · no period{" "}
            {quality.freshness.NONE ?? 0}
          </p>
          {quality.failures.length ? (
            <ul className="text-sm text-muted-foreground">
              {quality.failures.map((row) => (
                <li key={row.code}>
                  {row.code}: {row.count}
                  {row.examples.length ? ` (e.g. ${row.examples.slice(0, 4).join(", ")})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No typed fundamentals failures stored yet.</p>
          )}
          <p className="text-sm text-muted-foreground">Yahoo cannot: {quality.yahooCannot.join("; ")}.</p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          No fundamentals quality snapshot yet. Run{" "}
          <code className="font-mono">npm run fundamentals:yahoo</code> then{" "}
          <code className="font-mono">npm run fundamentals:report</code>.
        </p>
      )}

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
            <Stat label="Insufficient data" value={String(summary.scores.insufficient)} />
            <Stat
              label="Needs verification"
              value={String(summary.scores.needsVerification ?? 0)}
            />
          </section>
          <p className="text-sm text-muted-foreground">
            REITs {dq?.reits ?? 0} · PN17 {dq?.pn17 ?? 0} · price misses {summary.prices.failed} ·
            Yahoo statement misses {summary.fundamentalsYahoo.failed} · asOf {summary.asOf.slice(0, 19)}
          </p>

          <ScanTable
            title="Highest Research Score"
            rows={(summary.highlights.highestResearch ?? []).map((r) => ({
              ticker: r.ticker,
              extra: `${formatScore100(r.score)} · ${r.confidence ?? ""}`,
            }))}
          />
          <ScanTable
            title="Highest Valuation Score"
            rows={(summary.highlights.highestValuation ?? []).map((r) => ({
              ticker: r.ticker,
              extra: `${formatScore100(r.score)} · ${r.confidence ?? ""}`,
            }))}
          />
          <ScanTable
            title="High Score — Needs Verification"
            rows={(summary.highlights.needsVerification ?? []).map((r) => ({
              ticker: r.ticker,
              extra: `${formatScore100(r.score)} · ${r.confidence ?? ""} · ${String(r.freshness ?? "").replaceAll("_", " ")}`,
            }))}
            empty="No thin-coverage or stale high scores in this snapshot."
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
            <form className="mb-3 flex flex-wrap items-end gap-3" action="/market">
              <label className="flex flex-col gap-1 text-sm">Search ticker, company or sector<input className="rounded border px-3 py-2" type="search" name="q" defaultValue={q} /></label>
              <label className="flex flex-col gap-1 text-sm">Recommendation filter<select className="rounded border px-3 py-2" name="eligibility" defaultValue={eligibility}><option value="">All names</option><option value="eligible">Recommendable only</option><option value="excluded">Excluded only</option></select></label>
              <button className="rounded border px-3 py-2 text-sm" type="submit">Apply filters</button>
            </form>
            <p className="mb-2 text-sm">Showing {visible.length} of {rows.length} names. Excluded names remain scored.</p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Research</TableHead>
                    <TableHead className="text-right">Valuation</TableHead>
                    <TableHead>Data confidence</TableHead>
                    <TableHead>Recommendation eligibility</TableHead>
                    <TableHead>Freshness</TableHead>
                    <TableHead className="text-right">Coverage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
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
                      <TableCell>
                        {String(row.instrumentType)}
                        {row.researchProfile ? ` · ${String(row.researchProfile)}` : ""}
                      </TableCell>
                      <TableCell
                        className={`text-right ${row.needsVerification ? "text-muted-foreground" : ""}`}
                      >
                        {formatScore100(typeof row.researchScore === "number" ? row.researchScore : null)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${row.needsVerification ? "text-muted-foreground" : ""}`}
                      >
                        {formatScore100(typeof row.valuationScore === "number" ? row.valuationScore : null)}
                      </TableCell>
                      <TableCell>
                        {dataConfidenceLabel(String(row.confidence ?? "LOW"))}
                        {row.needsVerification ? (
                          <Badge className="ml-1" variant="outline">
                            Needs verification
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-80 text-sm">
                        {row.eligible === true ? "Eligible" : `Excluded: ${Array.isArray(row.exclusionReasons) ? row.exclusionReasons.join(" ") : "not verified"}`}
                      </TableCell>
                      <TableCell>{String(row.freshness ?? "—").replaceAll("_", " ")}</TableCell>
                      <TableCell className="text-right">
                        {typeof row.coreCoverageRatio === "number"
                          ? `${Math.round(row.coreCoverageRatio * 100)}% (${row.availableFactors}/${row.expectedFactors})`
                          : typeof row.coverage === "number"
                            ? `${(row.coverage * 100).toFixed(0)}%`
                            : "Data unavailable"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
