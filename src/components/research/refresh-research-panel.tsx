"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { RefreshAndResearchReport, RefreshCategoryId } from "@/refresh/on-demand";

const CATEGORY_LABELS: { id: RefreshCategoryId; label: string }[] = [
  { id: "prices", label: "Market prices" },
  { id: "fundamentals", label: "Fundamentals" },
  { id: "announcements", label: "Announcements" },
  { id: "events", label: "Events" },
  { id: "news", label: "News" },
  { id: "scores", label: "Research score" },
  { id: "fairValue", label: "Fair Value" },
];

export function RefreshResearchPanel({
  ticker,
  readOnly,
  marketPriceDate,
  researchRunAt,
  storedCategories,
}: {
  ticker: string;
  readOnly: boolean;
  marketPriceDate: string | null;
  researchRunAt: string | null;
  storedCategories: Partial<Record<RefreshCategoryId, { status: string; lastSuccessfulAt: string | null } | null>>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RefreshAndResearchReport | null>(null);

  async function onRefresh() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/refresh-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const body = (await response.json()) as RefreshAndResearchReport & { error?: string };
      if (!response.ok || body.kind !== "refresh-and-research") {
        setError(body.error ?? "Refresh & Research did not return a report.");
        return;
      }
      setReport(body);
      if (body.durable && body.overall !== "REFUSED" && body.overall !== "ALREADY_RUNNING") {
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh & Research failed before a report was returned.");
    } finally {
      setPending(false);
    }
  }

  const marketDate = report?.market.latestDate ?? marketPriceDate;
  const ranAt = report ? `${formatStamp(report.startedAt)} – ${formatStamp(report.completedAt)}` : "Not run in this view";

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Refresh & Research</h2>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "This website is serving a published snapshot. Refresh & Research stops before any price request because this host cannot save results."
              : "Fetches this instrument only and writes the local research database. Yahoo prices are end-of-day bars, not a live quote. This does not update the deployed website."}
          </p>
        </div>
        <Button type="button" onClick={onRefresh} disabled={pending} aria-busy={pending}>
          {pending ? "Refreshing…" : "Refresh & Research"}
        </Button>
      </div>
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          Publishing the updated database is a separate snapshot pack and deploy on your computer.
        </p>
      ) : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Refresh ran</dt>
          <dd className="font-medium">{ranAt}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Market data date</dt>
          <dd className="font-medium">{formatDay(marketDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last research run</dt>
          <dd className="font-medium">{formatStamp(report?.research.ranAt ?? researchRunAt)}</dd>
        </div>
      </dl>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {report ? <ReportSummary report={report} /> : null}
      <CategoryList report={report} storedCategories={storedCategories} />
    </section>
  );
}

function ReportSummary({ report }: { report: RefreshAndResearchReport }) {
  const tone =
    report.overall === "SUCCESS" || report.overall === "UNCHANGED"
      ? "text-foreground"
      : "text-destructive";
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className={tone}>
        {labelOverall(report.overall)} · {report.instruments.attempted} attempted,{" "}
        {report.instruments.priceSucceeded} price ok, {report.instruments.priceFailed} price failed,{" "}
        {report.instruments.fundamentalsSucceeded} fundamentals ok, {report.instruments.fundamentalsFailed}{" "}
        fundamentals failed.
      </p>
      <p className="text-muted-foreground">
        Stored price date {formatDay(report.market.previousDate)} → {formatDay(report.market.latestDate)}
        {report.market.updatedThisRun ? " (updated this run)" : " (not updated this run)"}. Persistence:{" "}
        {report.persistence}.
      </p>
      {report.notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

function CategoryList({
  report,
  storedCategories,
}: {
  report: RefreshAndResearchReport | null;
  storedCategories: Partial<Record<RefreshCategoryId, { status: string; lastSuccessfulAt: string | null } | null>>;
}) {
  return (
    <ul className="grid gap-1 text-sm">
      {CATEGORY_LABELS.map((item) => {
        const live = report?.categories[item.id];
        const stored = storedCategories[item.id];
        const knownGap = item.id === "announcements" || item.id === "events" || item.id === "news" ? "NO_SOURCE" : "not requested";
        const status = live?.status ?? stored?.status ?? knownGap;
        const last = live?.lastSuccessfulAt ?? stored?.lastSuccessfulAt ?? null;
        return (
          <li key={item.id} className="flex flex-wrap justify-between gap-2">
            <span>{item.label}</span>
            <span className="text-muted-foreground">
              {status}
              {live?.updatedThisRun ? " · updated" : ""}
              {" · last success "}
              {formatStamp(last)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function labelOverall(overall: RefreshAndResearchReport["overall"]) {
  if (overall === "SUCCESS") return "Completed";
  if (overall === "UNCHANGED") return "Completed, stored inputs unchanged";
  if (overall === "PARTIAL") return "Partial";
  if (overall === "REFUSED") return "Not saved";
  if (overall === "ALREADY_RUNNING") return "Already running";
  return "Failed";
}

function formatDay(value: string | null | undefined) {
  if (!value) return "Unavailable";
  return value.slice(0, 10);
}

function formatStamp(value: string | null | undefined) {
  if (!value) return "None";
  return value.slice(0, 16).replace("T", " ");
}
