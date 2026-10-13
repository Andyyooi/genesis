import { cancelWatchlistRefresh, runWatchlistRefreshAndResearch } from "@/refresh/watchlist";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { cancel?: unknown; onlyTickers?: unknown } | null;
  if (body?.cancel === true) {
    return Response.json({ cancelling: cancelWatchlistRefresh() });
  }
  const onlyTickers = Array.isArray(body?.onlyTickers)
    ? body.onlyTickers.filter((value): value is string => typeof value === "string" && /^[A-Z0-9]{1,12}$/i.test(value.trim()))
    : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* The client may have disconnected after cancellation. */
        }
      };
      try {
        const report = await runWatchlistRefreshAndResearch(
          { onlyTickers, signal: request.signal },
          { onProgress: (progress) => send({ type: "progress", progress }) },
        );
        send({ type: "done", report });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Watchlist refresh failed" });
      } finally {
        try {
          controller.close();
        } catch {
          /* Already closed. */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
