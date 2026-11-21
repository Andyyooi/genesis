import { expect, it } from "vitest";
import { priceRangeSince } from "@/ingest/import-prices";

it("backfills each stored gap with overlap, up to two years", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  expect(priceRangeSince("2026-09-24", now)).toBe("5d");
  expect(priceRangeSince("2026-09-05", now)).toBe("1mo");
  expect(priceRangeSince("2026-08-01", now)).toBe("3mo");
  expect(priceRangeSince("2026-06-01", now)).toBe("6mo");
  expect(priceRangeSince("2025-12-25", now)).toBe("1y");
  for (const date of [null, "bad", "2020-01-01", "2027-01-01"]) expect(priceRangeSince(date, now)).toBe("2y");
});
