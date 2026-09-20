import { createHash } from "node:crypto";
import type { ScoringConfig } from "@/config/load-scoring";

export function hashScoringConfig(config: ScoringConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}
