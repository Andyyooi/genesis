import type { NextRequest } from "next/server";
import { isSameOrigin } from "@/auth/origin";
import { applyPortfolioEdit, portfolioUpdate, portfolioView } from "@/lib/portfolio";
import { getPortfolioStore } from "@/lib/portfolio-store";

const offline = "Your saved stocks couldn’t be reached. Try again.";
const conflict = "Your saved stocks changed on another device. Review the latest list and try again.";
const invalid = "Invalid holdings or starred list (up to 1,000 holdings and 500 stars).";

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  const store = getPortfolioStore();
  if (!store) return reply({ mode: "browser" });
  try {
    const { record } = await store.read();
    return reply({ mode: "server", portfolio: portfolioView.parse(record) });
  } catch {
    return reply({ error: offline }, 503);
  }
}

export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  const store = getPortfolioStore();
  if (!store) return reply({ error: "Server storage isn’t set up." }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: invalid }, 400);
  const body = await request.text().catch(() => "");
  if (body.length > 200_000) return reply({ error: invalid }, 413);
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return reply({ error: invalid }, 400); }
  const update = portfolioUpdate.safeParse(payload);
  if (!update.success) return reply({ error: invalid }, 400);
  try {
    const { raw, record } = await store.read();
    if (record.revision !== update.data.revision) return reply({ error: conflict }, 409);
    let next;
    try {
      next = applyPortfolioEdit(record, update.data.edit);
    } catch {
      return reply({ error: invalid }, 400);
    }
    if (!await store.update(raw, next)) return reply({ error: conflict }, 409);
    return reply({ mode: "server", portfolio: portfolioView.parse(next) });
  } catch {
    return reply({ error: offline }, 503);
  }
}
