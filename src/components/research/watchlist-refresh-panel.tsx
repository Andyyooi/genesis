"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { WatchlistProgress, WatchlistRefreshReport } from "@/refresh/watchlist";

type StreamEvent =
  | { type: "progress"; progress: WatchlistProgress }
  | { type: "done"; report: WatchlistRefreshReport }
  | { type: "error"; error: string };

export function WatchlistRefreshPanel({
  readOnly,
  watchlistCount,
}: {
  readOnly: boolean;
  watchlistCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<WatchlistProgress | null>(null);
  const [report, setReport] = useState<WatchlistRefreshReport | null>(null);

  async function run(onlyTickers?: string[]) {
    if (pending) return;
    setPending(true);
    setCancelling(false);
    setError(null);
    setProgress(null);
    setReport(null);
    try {
      const response = await fetch("/api/refresh-research/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(onlyTickers ? { onlyTickers } : {}),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Watchlist refresh did not start.");
        return;
      }
      let finalReport: WatchlistRefreshReport | null = null;
      for await (const event of readEvents(response.body)) {
        if (event.type === "progress") setProgress(event.progress);
        if (event.type === "error") setError(event.error);
        if (event.type === "done") finalReport = event.report;
      }
      setReport(finalReport);
      if (finalReport?.durable) router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Watchlist refresh failed before a report was returned.");
    } finally {
      setPending(false);
      setCancelling(false);
    }
  }

  async function onCancel() {
    if (!pending || cancelling) return;
    setCancelling(true);
    await fetch("/api/refresh-research/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancel: true }),
    }).catch(() => undefined);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Refresh & Research</h2>
          <p className="text-sm text-muted-foreground">
            Refreshes the saved watchlist ({watchlistCount} names), one at a time. Yahoo prices are end-of-day bars, not a live quote.
            This writes the local research database. It does not update the deployed website.
          </p>
        </div>
        <div className="flex gap-2">
          {pending ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
          <Button type="button" onClick={() => run()} disabled={pending} aria-busy={pending}>
            {pending ? "Refreshing…" : "Refresh & Research"}
          </Button>
        </div>
      </div>
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          This deployed copy reads a frozen snapshot. A watchlist refresh here cannot save prices. A local refresh stays on that computer until a new snapshot is packed and deployed.
        </p>
      ) : null}
      {progress ? (
        <p className="text-sm" aria-live="polite">
          {progress.completed} of {progress.total} finished
          {progress.current ? ` · current ${progress.current}` : ""}
          {` · ${progress.failed} failed`}
          {progress.cancelled || cancelling ? " · stopping" : ""}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {report ? <WatchlistReport report={report} onRetry={(tickers) => run(tickers)} pending={pending} /> : null}
    </section>
  );
}

function WatchlistReport({
  report,
  onRetry,
  pending,
}: {
  report: WatchlistRefreshReport;
  onRetry: (tickers: string[]) => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {labelOverall(report.overall)} · {report.attempted} finished, {report.failed} failed
        {report.skipped.length ? `, ${report.skipped.length} not started` : ""}. Persistence: {report.persistence}. Pace {report.paceMs} ms.
      </p>
      <p className="text-muted-foreground">
        Market dates {formatDay(report.market.oldestPreviousDate)} → {formatDay(report.market.latestMarketDate)} · {report.market.updatedCount} price dates advanced · scores {report.calculations.scores} · Fair Value {report.calculations.fairValue}. Announcements, events, and news were not updated.
      </p>
      {report.notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
      <ul className="grid gap-1">
        {report.results.map((row) => (
          <li key={row.ticker} className="flex flex-wrap justify-between gap-2">
            <span>{row.ticker}</span>
            <span className="text-muted-foreground">
              {row.overall} · price {formatDay(row.market.previousDate)} → {formatDay(row.market.latestDate)}
              {row.market.updatedThisRun ? " · updated" : " · not updated"}
            </span>
          </li>
        ))}
      </ul>
      {report.failedTickers.length > 0 ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => onRetry(report.failedTickers)}>
          Retry failed ({report.failedTickers.join(", ")})
        </Button>
      ) : null}
    </div>
  );
}

function labelOverall(overall: WatchlistRefreshReport["overall"]) {
  if (overall === "SUCCESS") return "Completed";
  if (overall === "UNCHANGED") return "Completed, stored inputs unchanged";
  if (overall === "PARTIAL") return "Partial";
  if (overall === "CANCELLED") return "Stopped";
  if (overall === "REFUSED") return "Not saved";
  if (overall === "ALREADY_RUNNING") return "Already running";
  return "Failed";
}

function formatDay(value: string | null) {
  if (!value) return "Unavailable";
  return value.slice(0, 10);
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as StreamEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as StreamEvent;
}
