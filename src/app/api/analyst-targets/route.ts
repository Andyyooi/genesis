import { inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { MAX_IMPORT_BYTES } from "@/analyst-targets/limits";
import { readTargetInput, TargetInputError } from "@/analyst-targets/target";
import { getAnalystTargetStore, TARGET_STORE_UNAVAILABLE, TARGET_STORE_UNCONFIGURED } from "@/analyst-targets/store";
import { isSameOrigin } from "@/auth/origin";
import { getDb } from "@/db/client";
import { instruments } from "@/db/schema";

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function readBody(request: NextRequest) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_IMPORT_BYTES) return null;
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return reply({ error: "Invalid origin" }, 403);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "text/csv" && contentType !== "application/json") {
    return reply({ error: "Send a CSV file or a JSON target." }, 415);
  }
  let targets;
  try {
    const body = await readBody(request);
    if (body === null) return reply({ error: "The file must be 128 KB or smaller." }, 413);
    targets = readTargetInput(body, contentType === "text/csv");
  } catch (error) {
    return reply({ error: error instanceof TargetInputError ? error.message : "Couldn't read the upload as UTF-8." }, 400);
  }
  const store = getAnalystTargetStore();
  if (!store) return reply({ error: TARGET_STORE_UNCONFIGURED }, 503);
  try {
    const tickers = [...new Set(targets.map(({ ticker }) => ticker))];
    const known = new Set(getDb().select({ ticker: instruments.ticker }).from(instruments)
      .where(inArray(instruments.ticker, tickers)).all().map(({ ticker }) => ticker));
    const unknown = tickers.filter((ticker) => !known.has(ticker));
    if (unknown.length) return reply({ error: `Unknown Genesis ticker(s): ${unknown.join(", ")}.` }, 400);
    await store.save(targets);
    return reply({ processed: targets.length });
  } catch {
    return reply({ error: TARGET_STORE_UNAVAILABLE }, 503);
  }
}
