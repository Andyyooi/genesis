import type { NextRequest } from "next/server";
import { isSameOrigin } from "@/auth/origin";
import { loadWatchCloses, loadWatchInstrument } from "@/price-watches/snapshot";
import { getPriceWatchStore, WATCH_STORE_UNAVAILABLE, WATCH_STORE_UNCONFIGURED } from "@/price-watches/store";
import { watchRule, watchTicker, type PriceWatch } from "@/price-watches/watch";

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest, { params }: RouteContext<"/api/price-watches/[ticker]">) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  const { ticker } = await params;
  if (!watchTicker.safeParse(ticker).success) return reply({ error: "Unknown stock." }, 404);
  const rule = watchRule.safeParse(await request.json().catch(() => null));
  if (!rule.success) return reply({ error: "Choose the fair range or enter a target price above zero (up to three decimal places)." }, 400);
  const store = getPriceWatchStore();
  if (!store) return reply({ error: WATCH_STORE_UNCONFIGURED }, 503);
  try {
    const instrument = loadWatchInstrument(ticker);
    if (!instrument) return reply({ error: "Unknown stock." }, 404);
    const watch: PriceWatch = rule.data.kind === "target" ? { ...rule.data, ticker }
      : { ...rule.data, ticker, startCloseDate: loadWatchCloses(instrument.id)[0]?.date ?? null };
    await store.save(watch);
    return reply({ watch });
  } catch {
    return reply({ error: WATCH_STORE_UNAVAILABLE }, 503);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext<"/api/price-watches/[ticker]">) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  const { ticker } = await params;
  if (!watchTicker.safeParse(ticker).success) return reply({ error: "Unknown stock." }, 404);
  const store = getPriceWatchStore();
  if (!store) return reply({ error: WATCH_STORE_UNCONFIGURED }, 503);
  try {
    await store.remove(ticker);
    return reply({ watch: null });
  } catch {
    return reply({ error: WATCH_STORE_UNAVAILABLE }, 503);
  }
}
