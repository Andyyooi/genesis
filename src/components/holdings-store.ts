"use client";

import { useSyncExternalStore } from "react";
import { HOLDINGS_KEY, parseBackup } from "@/lib/holdings";

export const STARRED_KEY = "genesis:saved-companies:v1";

function subscribeHoldings(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("holdings-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("holdings-change", callback);
  };
}
function holdingsSnapshot() {
  try { return localStorage.getItem(HOLDINGS_KEY); } catch { return null; }
}
export function useHeldTickers() {
  const raw = useSyncExternalStore(subscribeHoldings, holdingsSnapshot, () => null);
  try { return new Set(raw ? parseBackup(raw).map(h => h.ticker) : []); } catch { return new Set<string>(); }
}

function subscribeStarred(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("genesis-saved", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("genesis-saved", callback);
  };
}
function starredSnapshot() {
  try { return localStorage.getItem(STARRED_KEY); } catch { return null; }
}
export function useStarredTickers() {
  const raw = useSyncExternalStore(subscribeStarred, starredSnapshot, () => null);
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 500) : []);
  } catch {
    return new Set<string>();
  }
}
