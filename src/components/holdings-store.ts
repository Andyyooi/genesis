"use client";

import { useSyncExternalStore } from "react";
import { backupJson, HOLDINGS_KEY, parseBackup, type Holding } from "@/lib/holdings";
import { emptyPortfolio, parseStars, portfolioEdit, portfolioView, STARRED_KEY, type PortfolioEdit, type PortfolioView } from "@/lib/portfolio";

type Snapshot = {
  mode: "loading" | "browser" | "server" | "error";
  portfolio: PortfolioView;
  busy: boolean;
  error?: string;
  unimportedHoldings?: Holding[];
};

const initial: Snapshot = { mode: "loading", portfolio: emptyPortfolio, busy: false };
const rejectedImportKey = "genesis:portfolio-import-rejected:v1";
const importWarning = "Your browser lists weren’t imported. They’re still saved in this browser, and you can use your synced lists.";
let snapshot = initial;
let loading: Promise<void> | undefined;
let rejectedImportRevision: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function readLegacy() {
  let holdingsRaw: string | null = null;
  let starredRaw: string | null = null;
  let holdings: PortfolioView["holdings"] = [];
  let starred: string[] = [];
  let error: string | undefined;
  try {
    const raw = localStorage.getItem(HOLDINGS_KEY);
    holdings = raw ? parseBackup(raw) : [];
    holdingsRaw = raw;
  } catch {
    error = "Could not read browser holdings. You can restore a backup on My holdings.";
  }
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    starred = parseStars(raw);
    starredRaw = raw;
  } catch {
    error ??= "Could not read browser stars.";
  }
  return { holdings, starred, holdingsRaw, starredRaw, error };
}

function importWasRejected(revision: number) {
  try {
    return rejectedImportRevision === String(revision) || localStorage.getItem(rejectedImportKey) === String(revision);
  } catch {
    return rejectedImportRevision === String(revision);
  }
}

function rememberRejection(revision: number | null) {
  rejectedImportRevision = revision === null ? null : String(revision);
  try {
    if (rejectedImportRevision === null) localStorage.removeItem(rejectedImportKey);
    else localStorage.setItem(rejectedImportKey, rejectedImportRevision);
  } catch {
    // This tab can still avoid repeating the same rejected import.
  }
}

class PortfolioError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function requestPortfolio(update?: { revision: number; edit: PortfolioEdit }) {
  const response = await fetch("/api/portfolio", {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    ...(update && { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) }),
  });
  const data = await response.json();
  if (!response.ok) throw new PortfolioError(data.error ?? "Saved stocks are unavailable.", response.status);
  return data.mode === "browser" ? null : portfolioView.parse(data.portfolio);
}

async function load() {
  try {
    let portfolio = await requestPortfolio();
    const legacy = readLegacy();
    if (!portfolio) {
      const unchanged = snapshot.mode === "browser" && JSON.stringify(snapshot.portfolio.holdings) === JSON.stringify(legacy.holdings)
        && JSON.stringify(snapshot.portfolio.starred) === JSON.stringify(legacy.starred);
      const revision = unchanged ? snapshot.portfolio.revision : snapshot.portfolio.revision + 1;
      publish({ mode: "browser", portfolio: { revision, holdings: legacy.holdings, starred: legacy.starred }, busy: false, error: legacy.error });
      return;
    }
    let error = legacy.error;
    let unimportedHoldings: Holding[] | undefined;
    if (legacy.holdings.length || legacy.starred.length) {
      if (importWasRejected(portfolio.revision)) {
        publish({ mode: "server", portfolio, busy: false, error: importWarning, unimportedHoldings: legacy.holdings });
        return;
      }
      const edit: PortfolioEdit = { kind: "migrate", holdings: legacy.holdings, starred: legacy.starred };
      try {
        let imported;
        try {
          imported = await requestPortfolio({ revision: portfolio.revision, edit });
        } catch (error) {
          if (!(error instanceof PortfolioError) || error.status !== 409) throw error;
          const latest = await requestPortfolio();
          if (!latest) throw error;
          portfolio = latest;
          imported = await requestPortfolio({ revision: portfolio.revision, edit });
        }
        if (!imported) throw new Error("Migration not saved");
        portfolio = imported;
        rememberRejection(null);
        try {
          if (localStorage.getItem(HOLDINGS_KEY) === legacy.holdingsRaw) localStorage.removeItem(HOLDINGS_KEY);
          if (localStorage.getItem(STARRED_KEY) === legacy.starredRaw) localStorage.removeItem(STARRED_KEY);
        } catch {
          // Migration does not overwrite server entries if the browser retries.
        }
      } catch (failure) {
        if (failure instanceof PortfolioError && (failure.status === 400 || failure.status === 413)) rememberRejection(portfolio.revision);
        error = importWarning;
        unimportedHoldings = legacy.holdings;
      }
    }
    publish({ mode: "server", portfolio, busy: false, error, unimportedHoldings });
  } catch {
    publish({ ...snapshot, mode: "error", busy: false, error: "Could not sync your saved stocks. Try again." });
  }
}

export function refreshPortfolio() {
  if (!snapshot.busy && !loading) loading = load().finally(() => { loading = undefined; });
  return loading;
}

function storageChanged(event: StorageEvent) {
  if (event.key === null || event.key === HOLDINGS_KEY || event.key === STARRED_KEY) void refreshPortfolio();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", refreshPortfolio);
    window.addEventListener("storage", storageChanged);
    void refreshPortfolio();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener("focus", refreshPortfolio);
      window.removeEventListener("storage", storageChanged);
    }
  };
}

export function usePortfolio() {
  return useSyncExternalStore(subscribe, () => snapshot, () => initial);
}

export function useHeldTickers() {
  return new Set(usePortfolio().portfolio.holdings.map(h => h.ticker));
}

export async function savePortfolio(edit: Exclude<PortfolioEdit, { kind: "migrate" }>, revision: number) {
  if (loading || snapshot.busy || (snapshot.mode !== "server" && snapshot.mode !== "browser") ||
    revision !== snapshot.portfolio.revision) throw new Error("Your saved stocks are updating. Try again.");
  if (!portfolioEdit.safeParse(edit).success) throw new Error("Save up to 1,000 holdings and 500 stars.");
  if (snapshot.mode === "browser") {
    try {
      if (edit.kind === "holdings") localStorage.setItem(HOLDINGS_KEY, backupJson(edit.holdings));
      else localStorage.setItem(STARRED_KEY, JSON.stringify(edit.starred));
    } catch {
      throw new Error("Could not save in this browser. Your previous list is unchanged.");
    }
    rememberRejection(null);
    const { holdings, starred, error } = readLegacy();
    publish({ ...snapshot, portfolio: { revision: revision + 1, holdings, starred }, error });
    return;
  }
  publish({ ...snapshot, busy: true });
  try {
    const portfolio = await requestPortfolio({ revision, edit });
    if (!portfolio) throw new Error("Server storage isn’t set up.");
    publish({ ...snapshot, portfolio, busy: false });
  } catch (error) {
    publish({ ...snapshot, busy: false });
    if (error instanceof PortfolioError && error.status === 409) void refreshPortfolio();
    throw error;
  }
}
