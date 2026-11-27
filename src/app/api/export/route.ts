import { EXPORT_CACHE_CONTROL, exportAuthError } from "@/auth/export-token";
import { loadResearchExport } from "@/export/research";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const headers = { "Cache-Control": EXPORT_CACHE_CONTROL };
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
  }
  const authError = exportAuthError(request);
  if (authError) return authError;

  try {
    return Response.json(loadResearchExport(), { headers });
  } catch {
    return Response.json({ error: "Cannot read saved research data." }, { status: 503, headers });
  }
}
