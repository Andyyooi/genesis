import Link from "next/link";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { StatusLabel } from "./status-label";
import { dataConfidenceLabel, formatScore100 } from "@/lib/research-copy";

const PAGE_SIZE = 25;

export function MarketResults({
  rows,
  total,
  query,
  eligibility,
  requestedPage,
}: {
  rows: Record<string, unknown>[];
  total: number;
  query: string;
  eligibility: string;
  requestedPage: string;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const parsed = /^\d+$/.test(requestedPage) ? Number(requestedPage) : 1;
  const page = Math.min(
    pages,
    Math.max(1, Number.isSafeInteger(parsed) ? parsed : 1),
  );
  const start = (page - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);
  function pageHref(next: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (eligibility) params.set("eligibility", eligibility);
    params.set("page", String(next));
    return `/market?${params}#companies`;
  }

  return (
    <section
      id="companies"
      className="market-card scan-workspace"
      aria-labelledby="scan-results-title"
    >
      <div className="scan-workspace-heading">
        <div>
          <p className="section-kicker">THE WIDER MARKET</p>
          <h2
            id="scan-results-title"
            className="text-xl font-semibold tracking-tight"
          >
            Explore companies
          </h2>
        </div>
        <span className="scan-count">
          {rows.length.toLocaleString("en-MY")} of{" "}
          {total.toLocaleString("en-MY")} names
        </span>
      </div>
      <form className="scan-filters" action="/market">
        <label className="scan-search">
          <span className="sr-only">Search ticker, company or sector</span>
          <Search size={17} aria-hidden="true" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search ticker, company or sector"
          />
        </label>
        <label className="scan-filter">
          <span>Eligibility</span>
          <select
            name="eligibility"
            aria-label="Eligibility"
            defaultValue={eligibility}
          >
            <option value="">All names</option>
            <option value="eligible">Eligible only</option>
            <option value="excluded">Excluded only</option>
          </select>
        </label>
        <button type="submit" className="scan-apply">
          Apply filters
        </button>
        {query || eligibility ? (
          <Link className="scan-reset" href="/market#companies">
            Clear filters
          </Link>
        ) : null}
      </form>
      <p className="scan-list-note">
        Scores are out of 100, not buy signals. Open a company for research;
        expand its review for coverage and exclusions.
      </p>
      {visible.length ? (
        <table className="scan-table" role="table">
          <caption className="sr-only">
            Market scan companies with research and valuation scores, data
            confidence, coverage and eligibility review
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col">Company</th>
              <th scope="col">Research</th>
              <th scope="col">Valuation</th>
              <th scope="col">Confidence</th>
              <th scope="col">Coverage</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visible.map((row) => {
              const ticker = String(row.ticker);
              const ratio =
                typeof row.coreCoverageRatio === "number"
                  ? row.coreCoverageRatio
                  : typeof row.coverage === "number"
                    ? row.coverage
                    : null;
              const coverage =
                ratio === null || !Number.isFinite(ratio)
                  ? null
                  : Math.round(ratio * 100);
              const needsVerification = row.needsVerification === true;
              return (
                <tr key={ticker} role="row">
                  <td className="scan-company" role="cell">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/stock/${ticker}`}
                        className="company-symbol"
                      >
                        {ticker}
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </Link>
                      {row.pn17 ? (
                        <StatusLabel level="PN17">PN17</StatusLabel>
                      ) : null}
                    </div>
                    <span className="scan-company-name">
                      {String(row.name ?? ticker)}
                    </span>
                  </td>
                  <td role="cell">
                    <span className="scan-mobile-label" aria-hidden="true">
                      Research
                    </span>
                    <ScanScore
                      value={row.researchScore}
                      muted={needsVerification}
                    />
                  </td>
                  <td role="cell">
                    <span className="scan-mobile-label" aria-hidden="true">
                      Valuation
                    </span>
                    <ScanScore
                      value={row.valuationScore}
                      muted={needsVerification}
                    />
                  </td>
                  <td role="cell">
                    <span className="scan-mobile-label" aria-hidden="true">
                      Confidence
                    </span>
                    <StatusLabel level={String(row.confidence ?? "LOW")}>
                      {dataConfidenceLabel(String(row.confidence ?? "LOW"))}
                    </StatusLabel>
                    {needsVerification ? (
                      <span className="scan-verification">
                        Needs verification
                      </span>
                    ) : null}
                  </td>
                  <td role="cell">
                    <span className="scan-mobile-label" aria-hidden="true">
                      Coverage
                    </span>
                    <span className="scan-coverage">
                      {coverage === null ? "Unavailable" : `${coverage}%`}
                    </span>
                    {coverage !== null ? (
                      <span className="scan-coverage-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, coverage))}%`,
                          }}
                        />
                      </span>
                    ) : null}
                  </td>
                  <td role="cell">
                    <details className="scan-row-details">
                      <summary
                        aria-label={`Review ${ticker}: ${row.eligible === true ? "eligible" : "excluded"}`}
                      >
                        <StatusLabel
                          level={
                            row.eligible === true ? "eligible" : "excluded"
                          }
                        >
                          {row.eligible === true ? "Eligible" : "Excluded"}
                        </StatusLabel>
                        <ChevronDown size={14} aria-hidden="true" />
                      </summary>
                      <div className="scan-review-content">
                        <p>
                          <strong>Type</strong>{" "}
                          {String(row.instrumentType ?? "Unknown")
                            .replaceAll("_", " ")
                            .toLowerCase()}
                        </p>
                        <p>
                          <strong>Profile</strong>{" "}
                          {String(row.researchProfile ?? "Unknown").replaceAll(
                            "_",
                            " ",
                          )}
                        </p>
                        <p>
                          <strong>Freshness</strong>{" "}
                          <StatusLabel level={String(row.freshness)}>
                            {String(row.freshness ?? "Unknown").replaceAll(
                              "_",
                              " ",
                            )}
                          </StatusLabel>
                        </p>
                        {typeof row.availableFactors === "number" &&
                        typeof row.expectedFactors === "number" ? (
                          <p>
                            <strong>Core factors</strong> {row.availableFactors}{" "}
                            of {row.expectedFactors}
                          </p>
                        ) : null}
                        {row.eligible !== true ? (
                          <p className="scan-exclusion">
                            {Array.isArray(row.exclusionReasons) &&
                            row.exclusionReasons.length
                              ? row.exclusionReasons.join(" ")
                              : "Not verified for recommendations."}
                          </p>
                        ) : (
                          <p>
                            Passes the current recommendation checks. This is
                            not a buy recommendation.
                          </p>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="scan-empty">
          <Search size={24} aria-hidden="true" />
          <h3>No companies match these filters</h3>
          <p>Try another ticker, company name or sector.</p>
          <Link href="/market#companies">Clear filters</Link>
        </div>
      )}
      <div className="scan-pagination">
        <p>
          {rows.length
            ? `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} of ${rows.length.toLocaleString("en-MY")} names`
            : "0 names"}
          <span>Excluded names remain scored.</span>
        </p>
        <nav aria-label="Market scan pages">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} rel="prev">
              Previous
            </Link>
          ) : (
            <span aria-disabled="true">Previous</span>
          )}
          <span className="scan-page-number">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} rel="next">
              Next
            </Link>
          ) : (
            <span aria-disabled="true">Next</span>
          )}
        </nav>
      </div>
    </section>
  );
}

function ScanScore({ value, muted }: { value: unknown; muted: boolean }) {
  const score =
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return (
    <span
      className={`scan-score${muted ? " score-muted" : ""}`}
      aria-label={formatScore100(score)}
    >
      {score === null ? (
        <span className="scan-unavailable">Unavailable</span>
      ) : (
        <>
          <strong>{score.toFixed(0)}</strong>
          <small>/100</small>
        </>
      )}
    </span>
  );
}
