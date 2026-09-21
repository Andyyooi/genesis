import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { INSTRUMENT_TYPES } from "@/db/schema";

const universeInstrumentSchema = z.object({
  ticker: z.string().min(1),
  bursa_code: z.string().optional(),
  yahoo_ticker: z.string().optional(),
  name: z.string().min(1),
  instrument_type: z.enum(INSTRUMENT_TYPES),
  listing_board: z.string().optional(),
    sector: z.string().optional(),
  industry: z.string().optional(),
  research_profile: z.enum(["GENERAL", "BANK", "REIT", "OTHER_FINANCIAL", "UNKNOWN"]).optional(),
  pn17: z.boolean().default(false),
  shariah_compliant: z.boolean().optional(),
});

const universeSchema = z.object({
  universe_name: z.string(),
  fallback: z.string(),
  currency: z.literal("MYR"),
  instruments: z.array(universeInstrumentSchema),
});

export type UniverseConfig = z.infer<typeof universeSchema>;
export type UniverseInstrument = z.infer<typeof universeInstrumentSchema>;

export function loadUniverseConfig(rootDir = process.cwd()): UniverseConfig {
  const path = join(rootDir, "config", "universe.yaml");
  const raw = parse(readFileSync(path, "utf8"));
  return universeSchema.parse(raw);
}
