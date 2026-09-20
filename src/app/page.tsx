import { asc } from "drizzle-orm";
import { getFactorProfile, loadScoringConfig } from "@/config/load-scoring";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";
import { seedUniverseFromYaml } from "@/db/seed";
import { formatMyr } from "@/lib/format-myr";

export const dynamic = "force-dynamic";

function loadPageData() {
  const scoring = loadScoringConfig();
  const universe = seedUniverseFromYaml();
  const db = getDb();
  const rows = db.select().from(instruments).orderBy(asc(instruments.ticker)).all();
  return { scoring, universe, rows };
}

export default function HomePage() {
  let data: ReturnType<typeof loadPageData>;
  try {
    data = loadPageData();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist failed to load</h1>
        <p className="text-muted-foreground">
          Check <code className="font-mono text-sm">config/universe.yaml</code> and{" "}
          <code className="font-mono text-sm">config/scoring.yaml</code>. Warrants and
          ETFs are not allowed.
        </p>
        <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-sm">{message}</pre>
      </main>
    );
  }

  const { scoring, universe, rows } = data;
  const reitCount = rows.filter((row) => row.instrumentType === "REIT").length;
  const pn17Count = rows.filter((row) => row.pn17).length;
  const defaultProfile = getFactorProfile(scoring, "COMMON_STOCK");
  const reitProfile = getFactorProfile(scoring, "REIT");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Phase 1 · local only · English · MYR</p>
        <h1 className="text-3xl font-semibold tracking-tight">Bursa watchlist</h1>
        <p className="max-w-2xl text-muted-foreground">
          Personal research universe for Andy Yooi. This page lists tickers only. There
          are no scores, prices, or invented fundamentals yet.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Names in SQLite</CardTitle>
            <CardDescription>{universe.universe_name}</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">REITs</CardTitle>
            <CardDescription>Separate factor profile later</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{reitCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PN17 flagged</CardTitle>
            <CardDescription>Status warning, not a score</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{pn17Count}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tickers</CardTitle>
          <CardDescription>
            Seeded from <code className="font-mono text-xs">config/universe.yaml</code>{" "}
            into SQLite on load. Last price is unavailable until Phase 2 ingest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The universe is empty. Add COMMON_STOCK or REIT rows to{" "}
              <code className="font-mono">config/universe.yaml</code> and refresh.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead className="hidden sm:table-cell">Bursa</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Sector</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Last price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono font-medium">{row.ticker}</TableCell>
                    <TableCell className="hidden font-mono text-muted-foreground sm:table-cell">
                      {row.bursaCode ?? "—"}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {row.sector ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.instrumentType === "REIT" ? "secondary" : "outline"}>
                        {row.instrumentType === "REIT" ? "REIT" : "Common stock"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.pn17 ? (
                        <Badge variant="destructive">PN17 — higher risk</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Listed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatMyr(null)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Scoring config loaded: weights sum to 100. Factor profiles{" "}
        <span className="font-medium text-foreground">default</span> (
        {defaultProfile.description}) and{" "}
        <span className="font-medium text-foreground">reit</span> ({reitProfile.description}
        ). News and technical categories are listed for later unavailable/renormalize
        handling. Fallback universe if the watchlist is not used: {universe.fallback}.
      </p>
    </main>
  );
}
