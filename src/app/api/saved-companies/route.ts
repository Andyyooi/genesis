import { loadOpportunity, toWorkspaceRow } from "@/opportunities/scan";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("tickers") ?? "";
  const tickers = [...new Set(requested.split(","))].slice(0, 500);
  const rows = tickers.flatMap((ticker) => {
    if (!/^[A-Z0-9._-]{1,32}$/.test(ticker)) return [];
    const row = loadOpportunity(ticker);
    return row ? [toWorkspaceRow(row)] : [];
  });
  return Response.json(rows);
}
