import type { NewsProvider } from "@/providers/types";

/** Phase 8 news stays CSV. Phase 16 uses curated fixture ingest (`npm run events:ingest`). Live Bursa scrape is not implemented. */
export class StubNewsProvider implements NewsProvider {
  readonly id = "news-stub";
  async list(): Promise<never[]> {
    return [];
  }
}
