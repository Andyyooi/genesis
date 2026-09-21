import Link from "next/link";
import { notFound } from "next/navigation";
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
import { scoreTicker } from "@/scoring/run-ticker";

export const dynamic = "force-dynamic";

function fmtScore(value: number | null) {
  if (value === null) return "Data unavailable";
  return value.toFixed(1);
}

export default async function ScoresDebugPage({
  params,
}: PageProps<"/scores/[ticker]">) {
  const { ticker } = await params;
  const scored = scoreTicker(ticker, true);
  if (!scored) notFound();
  const { result } = scored;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Watchlist
        </Link>
        {" · "}
        <Link href={`/stock/${scored.ticker}`} className="underline underline-offset-4">
          Research
        </Link>
        {" · "}
        <Link href={`/metrics/${scored.ticker}`} className="underline underline-offset-4">
          Metrics
        </Link>
        <span className="text-muted-foreground"> · score debug</span>
      </p>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{scored.ticker} scores</h1>
          <Badge variant={scored.instrumentType === "REIT" ? "secondary" : "outline"}>
            profile {result.profile}
          </Badge>
        </div>
        <p className="max-w-2xl text-muted-foreground">
          Config-driven Research Score and a separate Valuation Score. Weights come from{" "}
          <code className="font-mono text-xs">config/scoring.yaml</code>. Unavailable factors are
          omitted, not zero. This is not a buy/sell call.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Research Score</CardTitle>
            <CardDescription>Renormalized live categories</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{fmtScore(result.researchScore)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Valuation Score</CardTitle>
            <CardDescription>Valuation factors only — not a copy of research</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{fmtScore(result.valuationScore)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data Confidence</CardTitle>
            <CardDescription>Not a rewrite of the raw scores</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{result.dataConfidence.level}</p>
            <p className="text-sm text-muted-foreground">
              {result.dataCoverage.freshness} · {result.dataCoverage.available}/
              {result.dataCoverage.expected} core factors
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>config hash {result.configHash}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Coverage</TableHead>
                <TableHead>In this run</TableHead>
                <TableHead className="hidden md:table-cell">Warning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">
                    {category.id} ({category.configuredWeight}%)
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtScore(category.score)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(category.coverage * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell>{category.inThisRun ? "Yes" : "No"}</TableCell>
                  <TableCell className="hidden max-w-sm text-sm text-muted-foreground md:table-cell">
                    {category.warning ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Factor evidence</CardTitle>
          <CardDescription>Every factor, including unavailable ones</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="hidden md:table-cell">Period</TableHead>
                <TableHead className="hidden lg:table-cell">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.categories.flatMap((category) =>
                category.factors.map((factor) => (
                  <TableRow key={`${category.id}-${factor.id}`}>
                    <TableCell className="font-medium">{factor.label}</TableCell>
                    <TableCell>{category.id}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {factor.value === null ? "Data unavailable" : factor.value.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtScore(factor.score)}</TableCell>
                    <TableCell className="hidden font-mono text-sm text-muted-foreground md:table-cell">
                      {factor.period ?? "—"}
                    </TableCell>
                    <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground lg:table-cell">
                      {factor.available ? factor.formula : factor.reason}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Potential Concerns</CardTitle>
          <CardDescription>
            These factors triggered a warning. This is not a “value trap” stamp and does not
            change the Research Score.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.concerns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No concern rules fired for this snapshot.</p>
          ) : (
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {result.concerns.map((concern) => (
                <li key={concern.id}>
                  <span className="font-medium">{concern.label}.</span> {concern.message}
                  {concern.value !== null ? ` (value ${concern.value.toFixed(4)})` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
