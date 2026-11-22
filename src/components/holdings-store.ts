"use client";

import { useSyncExternalStore } from "react";
import { HOLDINGS_KEY, parseBackup } from "@/lib/holdings";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("holdings-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("holdings-change", callback);
  };
}
function snapshot() {
  try { return localStorage.getItem(HOLDINGS_KEY); } catch { return null; }
}
export function useHeldTickers() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  try { return new Set(raw ? parseBackup(raw).map(h => h.ticker) : []); } catch { return new Set<string>(); }
}
