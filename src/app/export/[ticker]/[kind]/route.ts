import { buildFullMarkdown } from "@/export/full";
import { buildExportPayload } from "@/export/payload";
import { buildQuickMarkdown } from "@/export/quick";
import { buildRawJson, buildTablesCsv } from "@/export/raw";

const KINDS = ["quick", "full", "json", "csv"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ ticker: string; kind: string }> },
) {
  const { ticker, kind } = await context.params;
  if (!isKind(kind)) {
    return new Response("Unknown export kind. Use quick, full, json, or csv.", { status: 400 });
  }
  const payload = buildExportPayload(ticker);
  if (!payload) {
    return new Response("Ticker not found", { status: 404 });
  }

  const stem = payload.instrument.ticker;
  if (kind === "quick") {
    return file(buildQuickMarkdown(payload), `${stem}-quick.md`, "text/markdown; charset=utf-8");
  }
  if (kind === "full") {
    return file(buildFullMarkdown(payload), `${stem}-full.md`, "text/markdown; charset=utf-8");
  }
  if (kind === "json") {
    return file(buildRawJson(payload), `${stem}-raw.json`, "application/json; charset=utf-8");
  }
  return file(buildTablesCsv(payload), `${stem}-tables.csv`, "text/csv; charset=utf-8");
}

function file(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
