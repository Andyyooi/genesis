"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";
import { StatusLabel } from "./status-label";
import { PriceSparkline } from "./price-sparkline";
import { dataConfidenceLabel, formatScore100 } from "@/lib/research-copy";
import { formatSharePrice } from "@/lib/format-myr";
import {
  formatPriceChange,
  latestPriceChange,
  type PricePoint,
} from "@/lib/price-history";

export type WorkspaceRow = {
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  researchScore: number | null;
  valuationScore: number | null;
  qualityScore: number | null;
  confidence: string | null;
  needsVerification: boolean;
  freshness: string | null;
  coverage: string | null;
  priceDate: string | null;
  pn17: boolean;
  prices: PricePoint[];
};

const SAVED_KEY = "genesis:saved-companies:v1";
let volatileSaved = "[]";
let volatileOnly = false;
function savedSnapshot() {
  if (volatileOnly) return volatileSaved;
  try {
    return window.localStorage.getItem(SAVED_KEY) ?? "[]";
  } catch {
    return volatileSaved;
  }
}
function persistSaved(next: string[]): boolean {
  volatileSaved = JSON.stringify(next);
  try {
    window.localStorage.setItem(SAVED_KEY, volatileSaved);
    volatileOnly = false;
    return true;
  } catch {
    volatileOnly = true;
    return false;
  }
}
function subscribeSaved(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("genesis-saved", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("genesis-saved", callback);
  };
}
function parseSaved(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

export function ResearchWorkspace({
  rows,
  visibleTickers,
  label,
  emptyReason,
  children,
}: {
  rows: WorkspaceRow[];
  visibleTickers: string[];
  label: string;
  emptyReason: string;
  children?: React.ReactNode;
}) {
  const saved = parseSaved(
    useSyncExternalStore(subscribeSaved, savedSnapshot, () => "[]"),
  );
  const [query, setQuery] = useState("");
  const [onlySaved, setOnlySaved] = useState(false);
  const [sector, setSector] = useState("");
  const [sort, setSort] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saveError, setSaveError] = useState(false);
  const available = new Set(visibleTickers);
  const sectors = [
    ...new Set(
      rows
        .filter((row) => available.has(row.ticker))
        .map((row) => row.sector)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const needle = query.trim().toLowerCase();
  const ordered = visibleTickers
    .map((ticker) => rows.find((row) => row.ticker === ticker))
    .filter((row): row is WorkspaceRow => Boolean(row));
  const visible = ordered.filter(
    (row) =>
      (!onlySaved || saved.includes(row.ticker)) &&
      (!sector || row.sector === sector) &&
      (!needle ||
        `${row.ticker} ${row.name} ${row.sector ?? ""}`
          .toLowerCase()
          .includes(needle)),
  );
  if (sort)
    visible.sort((a, b) => {
      const av =
        sort === "move"
          ? latestPriceChange(a.prices)
          : sort === "valuation"
            ? a.valuationScore
            : a.researchScore;
      const bv =
        sort === "move"
          ? latestPriceChange(b.prices)
          : sort === "valuation"
            ? b.valuationScore
            : b.researchScore;
      return av === null
        ? bv === null
          ? a.ticker.localeCompare(b.ticker)
          : 1
        : bv === null
          ? -1
          : bv - av || a.ticker.localeCompare(b.ticker);
    });
  const compared = selected
    .map((ticker) => rows.find((row) => row.ticker === ticker))
    .filter((row): row is WorkspaceRow => Boolean(row));

  function toggleSaved(ticker: string) {
    const next = saved.includes(ticker)
      ? saved.filter((item) => item !== ticker)
      : [...saved, ticker];
    setSaveError(!persistSaved(next));
    window.dispatchEvent(new Event("genesis-saved"));
  }

  return (
    <section
      className="market-card overflow-hidden"
      aria-label="Company research workspace"
    >
      <div className="workspace-heading">
        <div>
          <p className="section-kicker">YOUR RESEARCH DESK</p>
          <h2 className="text-xl font-semibold tracking-tight">{label}</h2>
        </div>
        <Link
          href="/market"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
        >
          Explore the market{" "}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="workspace-toolbar">
        <div className="workspace-tabs" aria-label="Company view">
          <button
            type="button"
            aria-pressed={!onlySaved}
            onClick={() => setOnlySaved(false)}
          >
            All companies <span>{ordered.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={onlySaved}
            onClick={() => setOnlySaved(true)}
          >
            <Star className="size-3.5" aria-hidden="true" /> My saved{" "}
            <span>
              {rows.filter((row) => saved.includes(row.ticker)).length}
            </span>
          </button>
        </div>
        <label className="workspace-search">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search watchlist companies</span>
          <input
            type="search"
            placeholder="Search company or sector"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="workspace-options">
        <label className="inline-flex items-center gap-2">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Sector</span>
          <select
            value={sector}
            onChange={(event) => setSector(event.target.value)}
          >
            <option value="">All sectors</option>
            {sectors.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <ArrowDownUp className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Order companies</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="">List order</option>
            <option value="research">Research score</option>
            <option value="valuation">Valuation score</option>
            <option value="move">Latest price change</option>
          </select>
        </label>
        <span className="ml-auto">
          {visible.length} shown · compare up to 3
        </span>
      </div>
      {children}
      {saveError ? (
        <p className="px-5 py-2 text-xs text-amber-800" role="status">
          Browser storage is blocked. Your saved list lasts only for this visit.
        </p>
      ) : null}
      {compared.length > 0 ? (
        <section className="comparison-panel" aria-label="Company comparison">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Side by side{" "}
              <span className="font-normal text-muted-foreground">
                · research, not a ranking to buy
              </span>
            </h3>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="inline-flex items-center gap-1 text-xs text-primary"
            >
              <X className="size-3.5" aria-hidden="true" />
              Clear comparison
            </button>
          </div>
          <div className="relative overflow-x-auto">
            <table className="comparison-table">
              <caption className="sr-only">
                Compare selected company research and data quality
              </caption>
              <thead>
                <tr>
                  <th scope="col">Saved snapshot</th>
                  {compared.map((row) => (
                    <th scope="col" key={row.ticker}>
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={`/stock/${row.ticker}`}
                          className="text-primary hover:underline"
                        >
                          {row.ticker}
                        </Link>
                        <button
                          type="button"
                          aria-label={`Remove ${row.ticker} from comparison`}
                          onClick={() =>
                            setSelected(
                              selected.filter(
                                (ticker) => ticker !== row.ticker,
                              ),
                            )
                          }
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [
                      "Last close",
                      (row: WorkspaceRow) => formatSharePrice(row.price),
                    ],
                    [
                      "Price date",
                      (row: WorkspaceRow) => row.priceDate ?? "Unavailable",
                    ],
                    [
                      "Research / 100",
                      (row: WorkspaceRow) => formatScore100(row.researchScore),
                    ],
                    [
                      "Valuation / 100",
                      (row: WorkspaceRow) => formatScore100(row.valuationScore),
                    ],
                    [
                      "Quality / 100",
                      (row: WorkspaceRow) => formatScore100(row.qualityScore),
                    ],
                    [
                      "Data confidence",
                      (row: WorkspaceRow) =>
                        `${dataConfidenceLabel(row.confidence)}${row.needsVerification ? " · Verify" : ""}`,
                    ],
                    [
                      "Accounts",
                      (row: WorkspaceRow) =>
                        row.freshness?.replaceAll("_", " ") ?? "Unavailable",
                    ],
                    [
                      "Core coverage",
                      (row: WorkspaceRow) => row.coverage ?? "Unavailable",
                    ],
                    [
                      "Sector",
                      (row: WorkspaceRow) => row.sector ?? "Unavailable",
                    ],
                    [
                      "Risk flag",
                      (row: WorkspaceRow) =>
                        row.pn17 ? "PN17" : "No PN17 flag stored",
                    ],
                  ] as const
                ).map(([title, value]) => (
                  <tr key={title}>
                    <th scope="row">{title}</th>
                    {compared.map((row) => (
                      <td key={row.ticker}>{value(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {compared.length < 2 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Tick another company below to compare the evidence.
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="relative overflow-x-auto">
        <table className="workspace-table">
          <caption className="sr-only">
            Company research. Changes compare the latest two saved closes, not
            live prices.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Save company</span>
              </th>
              <th scope="col">Company</th>
              <th scope="col" className="text-right">
                Last close / RM
              </th>
              <th scope="col" className="text-right">
                Change %
              </th>
              <th scope="col">30 observations</th>
              <th scope="col">Research</th>
              <th scope="col">Confidence</th>
              <th scope="col">
                <span className="sr-only">Compare company</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const change = latestPriceChange(row.prices);
              const isSelected = selected.includes(row.ticker);
              return (
                <tr key={row.ticker} data-selected={isSelected || undefined}>
                  <td>
                    <button
                      type="button"
                      className="save-company"
                      aria-label={`${saved.includes(row.ticker) ? "Unsave" : "Save"} ${row.ticker}`}
                      aria-pressed={saved.includes(row.ticker)}
                      onClick={() => toggleSaved(row.ticker)}
                    >
                      <Star
                        className="size-4"
                        fill={
                          saved.includes(row.ticker) ? "currentColor" : "none"
                        }
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                  <td className="min-w-48">
                    <Link
                      href={`/stock/${row.ticker}`}
                      className="company-symbol"
                    >
                      {row.ticker}
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                    <p
                      className="max-w-60 truncate text-xs text-muted-foreground"
                      title={row.name}
                    >
                      {row.name}
                    </p>
                    {row.pn17 ? (
                      <span className="text-xs font-semibold text-red-700">
                        PN17
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    <span className="font-semibold">
                      {row.price === null
                        ? "Unavailable"
                        : row.price.toLocaleString("en-MY", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 3,
                          })}
                    </span>
                    <p className="text-[10px] text-muted-foreground">
                      {row.priceDate ?? "No saved price"}
                    </p>
                  </td>
                  <td
                    className={`text-right text-xs font-semibold tabular-nums ${change === null || change === 0 ? "move-flat" : change > 0 ? "move-up" : "move-down"}`}
                  >
                    {formatPriceChange(change)}
                  </td>
                  <td>
                    <PriceSparkline points={row.prices} />
                  </td>
                  <td>
                    <div
                      className={`score-cell ${row.needsVerification ? "score-muted" : ""}`}
                    >
                      <span>
                        {row.researchScore === null
                          ? "—"
                          : row.researchScore.toFixed(0)}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          {" "}
                          /100
                        </span>
                      </span>
                      {row.researchScore !== null ? (
                        <span className="score-track">
                          <span
                            style={{
                              width: `${Math.max(0, Math.min(100, row.researchScore))}%`,
                            }}
                          />
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <StatusLabel level={row.confidence ?? "LOW"}>
                      {dataConfidenceLabel(row.confidence)}
                    </StatusLabel>
                    {row.needsVerification ? (
                      <p className="mt-1 text-[10px] text-amber-800">
                        Needs verification
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <label className="compare-check">
                      <input
                        type="checkbox"
                        aria-label={`Compare ${row.ticker}`}
                        checked={isSelected}
                        disabled={!isSelected && selected.length >= 3}
                        onChange={() =>
                          setSelected(
                            isSelected
                              ? selected.filter(
                                  (ticker) => ticker !== row.ticker,
                                )
                              : [...selected, row.ticker],
                          )
                        }
                      />
                      <Check className="size-3" aria-hidden="true" />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <Search
            className="mx-auto mb-3 size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="font-semibold">
            {ordered.length === 0
              ? "No companies in this view yet"
              : onlySaved && saved.length === 0
                ? "Build your own shortlist"
                : "No matching companies"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {ordered.length === 0
              ? emptyReason
              : onlySaved && saved.length === 0
                ? "Use the star beside a company in All companies to save it here."
                : "Try another search, sector, or research list. Your saved companies are kept."}
          </p>
          {ordered.length === 0 ? (
            <Link
              href="/"
              className="mt-4 inline-block text-sm font-semibold text-primary"
            >
              Back to full watchlist
            </Link>
          ) : (
            <button
              type="button"
              className="mt-4 text-sm font-semibold text-primary"
              onClick={() => {
                setQuery("");
                setSector("");
                setOnlySaved(false);
              }}
            >
              Reset search & view
            </button>
          )}
        </div>
      ) : null}
      <div className="workspace-footnote">
        <span>Stars are saved on this browser only.</span>
        <span>
          Change = latest vs previous saved close. Charts are not live.
        </span>
      </div>
    </section>
  );
}
