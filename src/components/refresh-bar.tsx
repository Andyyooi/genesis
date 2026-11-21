"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RefreshPhase, RefreshStatus } from "@/refresh/github";

const labels: Record<RefreshPhase, string> = {
  idle: "Ready", queued: "Queued", downloading: "Downloading prices & accounts", rescoring: "Re-scoring",
  publishing: "Publishing", deploying: "Deploying", done: "Done — reload to see new data", failed: "Failed",
};
const busy = (phase?: RefreshPhase) => phase !== undefined && ["queued", "downloading", "rescoring", "publishing", "deploying"].includes(phase);

export function RefreshBar({ latestPriceDate, missing, allowed }: { latestPriceDate: string | null; missing: string[]; allowed: boolean }) {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const configured = status?.configured ?? missing.length === 0;
  const running = busy(status?.phase);

  useEffect(() => {
    if (!allowed || missing.length > 0) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch("/api/refresh/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Cannot read refresh status");
        if (!cancelled) { setStatus(data); setError(null); }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Cannot read refresh status"); }
    }
    void poll();
    const timer = setInterval(() => { void poll(); }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [allowed, missing.length]);

  async function refresh() {
    setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      const data = await response.json();
      if (response.status === 409) { setStatus(data); return; }
      if (!response.ok) throw new Error(data.error ?? "Refresh request failed");
      setStatus(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Refresh request failed"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="mx-auto mt-3 flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
      <p className="font-semibold">Data as of {latestPriceDate ?? "unavailable"}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void refresh()} disabled={!allowed || !configured || submitting || running}>Refresh data</Button>
        <span className="text-muted-foreground">usually 10–20 minutes</span>
        <p role="status" aria-live="polite">
          {!configured ? `Refresh isn't set up yet — missing ${(status?.missing ?? missing).join(", ")}`
            : !allowed ? "Sign in to refresh data" : submitting ? "Requesting refresh…" : status ? labels[status.phase] : "Checking refresh status…"}
          {status && status.elapsedSeconds > 0 ? ` · ${Math.floor(status.elapsedSeconds / 60)}m ${status.elapsedSeconds % 60}s` : ""}
          {status?.html_url ? <> · <a className="underline" href={status.html_url} target="_blank" rel="noreferrer">View run</a></> : null}
          {status?.phase === "done" ? <> · <button className="underline" onClick={() => window.location.reload()}>Reload</button></> : null}
        </p>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
