import { loadOpportunity, toWorkspaceRow } from "@/opportunities/scan";
import { loadListFairRanges } from "@/fair-value/load-list-ranges";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("tickers") ?? "";
  const tickers = [...new Set(requested.split(","))].slice(0, 500);
  const found = tickers.flatMap((ticker) => {
    if (!/^[A-Z0-9._-]{1,32}$/.test(ticker)) return [];
    const row = loadOpportunity(ticker);
    return row ? [row] : [];
  });
  const fairRanges = loadListFairRanges(found.map((row) => row.ticker));
  return Response.json(found.map((row) => toWorkspaceRow(row, fairRanges[row.ticker])));
}
