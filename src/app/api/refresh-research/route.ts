import { runRefreshAndResearch } from "@/refresh/on-demand";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ticker?: unknown } | null;
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{1,12}$/.test(ticker)) {
    return Response.json({ error: "Ticker is required." }, { status: 400 });
  }
  const report = await runRefreshAndResearch({ ticker });
  return Response.json(report);
}
