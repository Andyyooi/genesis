import { afterEach, expect, it, vi } from "vitest";
import { backupJson, HOLDINGS_KEY } from "@/lib/holdings";
import { applyPortfolioEdit, emptyRecord, MAX_STARS, portfolioView, STARRED_KEY, type PortfolioEdit } from "@/lib/portfolio";

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("preserves usable server lists and browser originals when a combined import exceeds the limit", async () => {
  const legacyHoldings = backupJson([{ ticker: "TAANN", shares: 100, averagePrice: 4 }]);
  const legacyStars = JSON.stringify(["TAANN"]);
  const storage = new Map([[HOLDINGS_KEY, legacyHoldings], [STARRED_KEY, legacyStars]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });

  let record = { ...emptyRecord, revision: 5, starred: Array.from({ length: MAX_STARS }, (_, i) => `STOCK${i}`) };
  const imports = vi.fn();
  const reply = () => Response.json({ mode: "server", portfolio: portfolioView.parse(record) });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method !== "PUT") return reply();
    const { revision, edit } = JSON.parse(String(init.body)) as { revision: number; edit: PortfolioEdit };
    expect(revision).toBe(record.revision);
    if (edit.kind === "migrate") imports();
    try {
      record = applyPortfolioEdit(record, edit);
      return reply();
    } catch {
      return Response.json({ error: "Combined lists are too large" }, { status: 400 });
    }
  });

  let store = await import("@/components/holdings-store");
  await store.refreshPortfolio();
  expect(store.usePortfolio()).toMatchObject({
    mode: "server", portfolio: portfolioView.parse(record), error: expect.stringContaining("weren’t imported"),
  });
  expect(storage.get(HOLDINGS_KEY)).toBe(legacyHoldings);
  expect(storage.get(STARRED_KEY)).toBe(legacyStars);

  vi.resetModules();
  store = await import("@/components/holdings-store");
  await store.refreshPortfolio();
  expect(imports).toHaveBeenCalledTimes(1);
  expect(store.usePortfolio().mode).toBe("server");

  await store.savePortfolio({ kind: "starred", starred: record.starred.slice(1) }, record.revision);
  await store.refreshPortfolio();
  expect(store.usePortfolio()).toMatchObject({ mode: "server", portfolio: { starred: expect.arrayContaining(["TAANN"]) } });
  expect(store.usePortfolio().error).toBeUndefined();
  expect(imports).toHaveBeenCalledTimes(2);
  expect(storage.has(HOLDINGS_KEY)).toBe(false);
  expect(storage.has(STARRED_KEY)).toBe(false);
});
