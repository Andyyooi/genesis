import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Activity,
  Bookmark,
  Minus,
} from "lucide-react";
import { Disclosure } from "@/components/research/disclosure";
import { DashboardFilters } from "@/components/research/dashboard-filters";
import { TopPicks } from "@/components/research/top-picks";
import { PriceCheckCard } from "@/components/research/price-check-card";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import { loadRecentAlerts } from "@/alerts/refresh";
import { loadScoringConfig } from "@/config/load-scoring";
import { loadLatestIngestReports } from "@/db/queries";
import { loadMarketPricePulse } from "@/db/price-history";
import { AlertsList } from "@/components/alerts/alerts-list";
import type { PricesImportReport } from "@/ingest/types";
import {
  OPPORTUNITY_LISTS,
  parseDashboardFilters,
  parseDashboardSort,
  parseListId,
  rowMatchesFilters,
  rowMatchesList,
  sortOpportunityRows,
  type ListId,
} from "@/opportunities/lists";
import { scanWatchlist, toWorkspaceRow } from "@/opportunities/scan";
import { parseTopPicksOptions } from "@/opportunities/top-picks";
import { loadPriceCheck } from "@/refresh/price-check";

export const dynamic = "force-dynamic";

function listHref(
  id: ListId,
  extra: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (id !== "watchlist") params.set("list", id);
  for (const [key, value] of Object.entries(extra))
    if (value) params.set(key, value);
  return params.size ? `/?${params}` : "/";
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const topPicksOptions = parseTopPicksOptions(params);
  const topPicksPreservedParams = Object.fromEntries(Object.entries(params).filter(([key, value]) => key !== "qualityTilt" && key !== "lotBudget" && typeof value === "string")) as Record<string, string>;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  const listId = parseListId(value("list"));
  const sortId = parseDashboardSort(value("sort"));
  const flagFilters = parseDashboardFilters({
    type: value("type"),
    shariah: value("shariah"),
    board: value("board"),
    cap: value("cap"),
    confidence: value("confidence"),
    freshness: value("freshness"),
    profile: value("profile"),
  });
  const filterQuery = {
    qualityTilt: topPicksOptions.qualityTilt ? "on" : undefined,
    lotBudget: topPicksOptions.lotBudget?.toString(),
    type: flagFilters.instrumentType,
    shariah: flagFilters.shariah ? "yes" : undefined,
    board: flagFilters.board,
    cap: flagFilters.cap,
    confidence: flagFilters.confidence,
    freshness: flagFilters.freshness,
    profile: flagFilters.profile,
    sort: sortId === "ticker" ? undefined : sortId,
  };
  let rows: ReturnType<typeof scanWatchlist>;
  let reports: ReturnType<typeof loadLatestIngestReports>;
  let recentAlerts: ReturnType<typeof loadRecentAlerts>;
  let priceCheck: ReturnType<typeof loadPriceCheck>;
  try {
    loadScoringConfig();
    rows = scanWatchlist();
    reports = loadLatestIngestReports();
    recentAlerts = loadRecentAlerts(6);
    priceCheck = loadPriceCheck();
  } catch {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-2xl font-semibold">
          Research is temporarily unavailable
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your saved data could not be opened. Check the data reports before
          trying again.
        </p>
        <Link
          href="/ingest"
          className="mt-4 inline-block text-primary underline"
        >
          Open data reports
        </Link>
      </main>
    );
  }
  const activeList =
    OPPORTUNITY_LISTS.find((item) => item.id === listId) ??
    OPPORTUNITY_LISTS[0]!;
  const listed = activeList.disabled
    ? []
    : rows.filter((row) => rowMatchesList(row, listId));
  const visible = sortOpportunityRows(
    listed.filter((row) => rowMatchesFilters(row, flagFilters)),
    sortId,
  );
  const workspaceRows = rows.map(toWorkspaceRow);
  const marketPulse = loadMarketPricePulse();
  const latestDate = marketPulse.date;
  const { higher, lower, unchanged: flat } = marketPulse;
  const listCounts = new Map(
    OPPORTUNITY_LISTS.map((item) => [
      item.id,
      item.disabled
        ? 0
        : rows.filter((row) => rowMatchesList(row, item.id)).length,
    ]),
  );
  const emptyLists = OPPORTUNITY_LISTS.filter(
    (item) => !listCounts.get(item.id) && item.id !== listId,
  );
  const lowConf = rows.filter(
    (row) =>
      row.confidence === "LOW" ||
      row.confidence === "VERY_LOW" ||
      row.needsVerification,
  ).length;
  const priceReport = reports.prices
    ? (JSON.parse(reports.prices.summaryJson) as PricesImportReport)
    : null;
  const failures = priceReport?.failed ?? [];

  return (
    <main className="research-home mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-7 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker mb-2">BURSA MALAYSIA / YOUR WORKSPACE</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Your market. In focus.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Less noise. A clearer view of the companies that matter to you.
          </p>
        </div>
        <span className="snapshot-chip">
          <span />
          Saved prices · {latestDate ?? "unavailable"}
        </span>
      </header>

      <section
        aria-label="Published Malaysian market snapshot"
        className="pulse-grid"
      >
        <div className="pulse-card">
          <div className="pulse-label">
            <span>Malaysian market coverage</span>
            <Bookmark className="size-4" aria-hidden="true" />
          </div>
          <p className="pulse-number">
            {marketPulse.total.toLocaleString("en-MY")}
            <span>listed stocks & REITs</span>
          </p>
          <Link href="/market" className="pulse-link">
            Explore all listed names{" "}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">
            <span>Closed higher</span>
            <ArrowUpRight className="size-4 move-up" aria-hidden="true" />
          </div>
          <p className="pulse-number move-up">
            {higher}
            <span>vs previous saved close</span>
          </p>
          <div className="pulse-bar">
            <span
              className="bg-emerald-600"
              style={{
                width: `${marketPulse.covered ? (higher / marketPulse.covered) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">
            <span>Closed lower</span>
            <ArrowDownRight className="size-4 move-down" aria-hidden="true" />
          </div>
          <p className="pulse-number move-down">
            {lower}
            <span>vs previous saved close</span>
          </p>
          <div className="pulse-bar">
            <span
              className="bg-red-500"
              style={{
                width: `${marketPulse.covered ? (lower / marketPulse.covered) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="pulse-card">
          <div className="pulse-label">
            <span>Closed unchanged</span>
            <Minus
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <p className="pulse-number">
            {flat}
            <span>vs previous saved close</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {marketPulse.missing} unavailable or older
          </p>
        </div>
      </section>
      <p className="-mt-3 text-[11px] text-muted-foreground">
        Published market coverage: {marketPulse.covered.toLocaleString("en-MY")}{" "}
        listed names with two saved closes ending{" "}
        {latestDate ?? "on an unavailable date"}. {marketPulse.missing}{" "}
        unavailable or older. This is the saved stock universe, not a Bursa
        index or live market feed.
      </p>

      <div className="research-grid">
        <div className="flex min-w-0 flex-col gap-5">
          <nav className="research-list-tabs" aria-label="Research lists">
            {OPPORTUNITY_LISTS.filter(
              (item) => listCounts.get(item.id) || item.id === listId,
            ).map((item) => (
              <Link
                key={item.id}
                href={listHref(item.id, filterQuery)}
                aria-current={item.id === listId ? "page" : undefined}
              >
                {item.label}
                <span>{listCounts.get(item.id)}</span>
              </Link>
            ))}
          </nav>
          {emptyLists.length ? (
            <details className="empty-list-details">
              <summary className="cursor-pointer">
                Other research lists · no matches in this watchlist
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {emptyLists.map((item) => (
                  <div key={item.id}>
                    <Link
                      href={listHref(item.id, filterQuery)}
                      className="font-semibold text-primary underline underline-offset-2"
                    >
                      {item.label}
                    </Link>
                    <p className="mt-1">
                      {item.description} No tracked company currently meets
                      this rule in the saved data.
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <ResearchWorkspace
            rows={workspaceRows}
            visibleTickers={visible.map((row) => row.ticker)}
            label={activeList.label}
            watchlistDescription={listId === "watchlist" ? rows.some((row) => row.watchlistReason)
              ? "Updated with each data refresh. Top picks have the strongest research scores; big movers had the largest price swings over five trading sessions."
              : "Showing the original list until a market watchlist is available from a data refresh."
              : undefined}
            emptyReason={
              listed.length > 0
                ? "No companies meet your selected filters. Open Filters & sort to change or clear them."
                : `No tracked company currently meets this rule in the saved data: ${activeList.description}`
            }
          >
            <div className="workspace-advanced">
              <DashboardFilters
                key={JSON.stringify(filterQuery)}
                listId={listId}
                values={filterQuery}
              />
            </div>
          </ResearchWorkspace>
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer text-primary">
              About {activeList.label.toLowerCase()}
            </summary>
            <p className="mt-2 max-w-3xl">
              {activeList.description} {activeList.disabledReason} Research
              scores are relative comparisons, not expected returns or fair
              values. Missing inputs are never filled with zero.
            </p>
          </details>
          <Disclosure
            title="Recent alerts"
            hint={`${recentAlerts.length} saved updates · open to review`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent alerts</h2>
              <Link href="/alerts" className="text-sm text-primary underline">
                All alerts
              </Link>
            </div>
            <AlertsList
              rows={recentAlerts}
              empty="No saved alerts yet. Open All alerts to review the available data."
            />
          </Disclosure>
        </div>
        <aside
          className="flex min-w-0 flex-col gap-5"
          aria-label="Research context"
        >
          <PriceCheckCard report={priceCheck.report} fromRefresh={priceCheck.fromRefresh} />
          <TopPicks key={JSON.stringify(topPicksOptions)} options={topPicksOptions} preservedParams={topPicksPreservedParams} />
          <section className="market-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="size-4 text-primary" aria-hidden="true" />
              <h2 className="font-semibold">Watchlist data checks</h2>
            </div>
            <div className="context-line">
              <span>Needs a closer look</span>
              <strong className="text-amber-800">{lowConf}</strong>
            </div>
            <div className="context-line">
              <span>Price import misses</span>
              <strong>{failures.length}</strong>
            </div>
            {failures.length ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-amber-800">
                  Which prices were missed?
                </summary>
                <p className="mt-2">
                  {failures.map((item) => item.ticker).join(", ")}. Old saved
                  prices may remain; no prices were invented.
                </p>
              </details>
            ) : null}
            <Link
              href="/ingest"
              className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              View data reports{" "}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </section>
          <div className="research-note">
            <p className="mb-2 font-semibold">
              Built for research. Not trading.
            </p>
            <p>
              Prices are saved observations, not live quotes. Use Refresh data
              when you want a new publication. Your shortlist helps you
              investigate, not decide what to buy or sell.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
