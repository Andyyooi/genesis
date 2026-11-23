import { afterEach, expect, it, vi } from "vitest";
import { loadListFairRanges, loadMarketScanFairRanges } from "@/fair-value/load-list-ranges";

const { all } = vi.hoisted(() => ({ all: vi.fn() }));
vi.mock("@/db/client", () => ({ getSqlite: () => ({ prepare: () => ({ all }) }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("reuses only the matching snapshot Market scan ranges, not other callers' results", () => {
  vi.stubEnv("BURSA_SNAPSHOT_READONLY", "1");
  all.mockImplementation((ticker: unknown) => typeof ticker === "string" ? [{ id: 1, ticker, lastClose: 1 }] : []);
  const first = loadMarketScanFairRanges(["A"]);
  expect(first).toEqual({ A: { available: false } });
  expect(loadMarketScanFairRanges(["A"])).toBe(first);
  expect(all).toHaveBeenCalledTimes(2);
  expect(loadMarketScanFairRanges(["B"])).toEqual({ B: { available: false } });
  expect(loadListFairRanges(["A"])).toEqual(first);
  expect(all).toHaveBeenCalledTimes(6);
});

it("always reads the current Market scan ranges in writable mode", () => {
  vi.stubEnv("BURSA_SNAPSHOT_READONLY", "0");
  vi.stubEnv("VERCEL", "0");
  all.mockReturnValueOnce([]);
  expect(loadMarketScanFairRanges(["A"])).toEqual({});
  all.mockReturnValueOnce([{ id: 1, ticker: "A", lastClose: 1 }]).mockReturnValueOnce([]);
  expect(loadMarketScanFairRanges(["A"])).toEqual({ A: { available: false } });
});
