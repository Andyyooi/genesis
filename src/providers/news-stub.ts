import type { NewsProvider } from "@/providers/types";

/** Phase 8 news stays CSV. Market-wide news is not implemented. */
export class StubNewsProvider implements NewsProvider {
  readonly id = "news-stub";
  async list(): Promise<never[]> {
    return [];
  }
}
