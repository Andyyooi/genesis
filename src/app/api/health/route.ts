import { loadDataHealth } from "@/refresh/data-health";

export const dynamic = "force-dynamic";

export function GET() {
  const health = loadDataHealth();
  return Response.json(health ?? { status: "unavailable", error: "Cannot read saved research data." }, {
    status: health ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
