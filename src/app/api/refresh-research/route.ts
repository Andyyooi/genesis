export async function POST() {
  return Response.json({ error: "Local website refreshes have been retired. Use Refresh data in the header (POST /api/refresh)." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
