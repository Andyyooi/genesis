import { CATEGORY_LABELS, formatContextHeadline, formatScore100, scoreNarrative, strongestPositives } from "@/lib/research-copy";
import { unavailableLabel, type ExportPayload } from "@/export/payload";

function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Data unavailable";
  return String(value);
}

export function buildFullMarkdown(payload: ExportPayload): string {
  const { instrument, score, metrics, financial_periods } = payload;
  const positives = strongestPositives(score, 8);
  const sections: string[] = [
    `# Full research report — ${instrument.ticker}`,
    "",
    payload.disclaimer,
    "",
    "## Instrument",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Name | ${instrument.name} |`,
    `| Ticker | ${instrument.ticker} |`,
    `| instrument_type | ${instrument.instrument_type} |`,
    `| research_profile | ${instrument.research_profile ?? score.researchProfile} |`,
    `| Scoring factor set | ${score.profile} |`,
    `| Bursa code | ${unavailableLabel(instrument.bursa_code)} |`,
    `| Sector | ${unavailableLabel(instrument.sector)} |`,
    `| Currency | ${instrument.currency} |`,
    `| PN17 status | ${instrument.pn17 ? "Yes — higher-risk warning, not a silent score penalty" : "No"} |`,
    `| asOf | ${score.asOf} |`,
    `| fundamentals period | ${unavailableLabel(payload.dates.fundamentals_period)} |`,
    `| price as-of / last trade | ${unavailableLabel(payload.dates.last_trade_date)} |`,
    `| config hash | ${score.configHash} |`,
    "",
    payload.dates.lag_note,
    "",
  ];

  if (score.profile === "reit") {
    sections.push(
      "This export uses the **REIT** factor profile (distribution yield, book NAV premium, DPU CAGR, gearing). Industrial FCF, net debt/EBITDA, EV/EBITDA, and ordinary-company P/E are not scoring factors.",
      "",
    );
  } else if (score.profile === "bank") {
    sections.push(
      "This export uses the **bank** overlay (P/B and ROE). Industrial FCF, net debt/EBITDA, and EV/EBITDA are not scoring factors.",
      "",
    );
  }

  sections.push(
    "## Scores",
    "",
    `- Research Score: ${formatScore100(score.researchScore)}`,
    `- Valuation Score: ${formatScore100(score.valuationScore)} (valuation factors only)`,
    `- Historical Context: ${formatContextHeadline(score.valuationContext.historical.label)} (${score.valuationContext.historical.historicalValuationStatus}) (not blended into Valuation Score)`,
    `- Peer Context: ${formatContextHeadline(score.valuationContext.peer.label)} (not blended into Valuation Score)`,
    score.valuationContext.peer.peerQuality
      ? `- Peer group: ${score.valuationContext.peer.peerQuality.usableCount} usable / ${score.valuationContext.peer.peerQuality.eligibleCount} eligible (${score.valuationContext.peer.peerQuality.groupType}; ${score.valuationContext.peer.peerQuality.selectionPath})`
      : "",
    `- Data Confidence: ${score.dataConfidence.level}${score.dataConfidence.needsVerification ? " — needs verification" : ""}`,
    `- Data freshness: ${score.dataCoverage.freshness}`,
    `- Core coverage: ${score.dataCoverage.available} of ${score.dataCoverage.expected} expected factors (${Math.round(score.dataCoverage.coverageRatio * 100)}%)`,
    "",
    score.dataConfidence.reasons.map((r) => `- ${r}`).join("\n"),
    "",
    scoreNarrative(score),
    "",
    "### Historical Context",
    "",
    score.valuationContext.historical.limitation
      ? `${score.valuationContext.historical.limitation}`
      : "",
    "",
    ...score.valuationContext.historical.facts.map((f) => `- ${f}`),
    "",
    "### Peer Context",
    "",
    score.valuationContext.peer.limitation ? `${score.valuationContext.peer.limitation}` : "",
    "",
    ...score.valuationContext.peer.facts.map((f) => `- ${f}`),
    "",
    "### Coverage and live weights",
    "",
    `| Category | Configured weight | In this run | Live weight | Score | Coverage | Warning |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...score.categories.map(
      (c) =>
        `| ${CATEGORY_LABELS[c.id] ?? c.id} | ${c.configuredWeight}% | ${c.inThisRun ? "yes" : "no"} | ${c.liveWeight === null ? "n/a" : `${(c.liveWeight * 100).toFixed(1)}%`} | ${formatScore100(c.score)} | ${(c.coverage * 100).toFixed(0)}% | ${c.warning ?? "—"} |`,
    ),
    "",
    ...score.notes.map((n) => `- ${n}`),
    "",
    "## Why it is interesting",
    "",
    positives.length
      ? positives.map((f) => `- **${f.label}** (${CATEGORY_LABELS[f.category] ?? f.category}): score ${formatScore100(f.score)}; period ${unavailableLabel(f.period)}.`).join("\n")
      : "No factor scored 60 or above.",
    "",
    "## Potential Concerns",
    "",
    "These factors triggered a warning. This is not a value-trap stamp and does not change the Research Score.",
    "",
    score.concerns.length
      ? score.concerns
          .map(
            (c) =>
              `- **${c.label}.** ${c.message} Metric: ${unavailableLabel(c.metricId)}. Value: ${num(c.value)}. Period: ${unavailableLabel(c.period)}.`,
          )
          .join("\n")
      : "No concern rules fired.",
    "",
    "## Factor evidence",
    "",
    "Every factor is listed. Unavailable factors are omitted from averages and are **not** scored as zero.",
    "",
  );

  for (const category of score.categories) {
    sections.push(
      `### ${CATEGORY_LABELS[category.id] ?? category.id}`,
      "",
      `Coverage: ${(category.coverage * 100).toFixed(0)}% of factor weights. Configured category weight: ${category.configuredWeight}%. ${category.warning ?? ""}`,
      "",
    );
    if (category.factors.length === 0) {
      sections.push("No factors in this profile.", "");
      continue;
    }
    for (const factor of category.factors) {
      sections.push(
        `#### ${factor.label} (\`${factor.id}\`)`,
        "",
        `- metric: ${factor.metricId}`,
        `- available: ${factor.available ? "yes" : "no"}`,
        `- value: ${num(factor.value)}`,
        `- score: ${factor.score === null ? "Data unavailable" : factor.score.toFixed(2)}`,
        `- period: ${unavailableLabel(factor.period)}`,
        `- formula / rule: ${factor.formula}`,
        `- notes: ${unavailableLabel(factor.notes)}`,
        factor.reason ? `- why unavailable: ${factor.reason}` : "",
        "- inputs:",
        factor.inputs.length
          ? factor.inputs
              .map(
                (input) =>
                  `  - ${input.name}: ${num(input.value)} · period ${unavailableLabel(input.period ?? null)}`,
              )
              .join("\n")
          : "  - Data unavailable",
        "",
      );
    }
  }

  sections.push(
    "## Metrics (computed from snapshots)",
    "",
    `| id | label | available | value | period | formula |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...metrics.map(
      (m) =>
        `| ${m.id} | ${m.label} | ${m.available} | ${num(m.value)} | ${unavailableLabel(m.period)} | ${m.formula.replace(/\|/g, "/")} |`,
    ),
    "",
    "## Financial periods",
    "",
    "Amounts are as stored (MYR). Blank source cells were not invented. `available_at` is publication time when known; missing stays UNKNOWN. `retrieved_at` is ingest time and is not used as available_at.",
    "",
  );

  if (financial_periods.length === 0) {
    sections.push("Data unavailable — no financial periods stored.", "");
  } else {
    for (const period of financial_periods) {
      const items = period.line_items;
      sections.push(
        `### Period ending ${period.period_end}`,
        "",
        `- statement_type: ${period.statement_type}`,
        `- actual_or_estimate: ${period.actual_or_estimate}`,
        `- source: ${period.source}`,
        `- fiscal_period: ${unavailableLabel(period.fiscal_period)}`,
        `- filing_date: ${unavailableLabel(period.filing_date)}`,
        `- available_at: ${unavailableLabel(period.available_at)}`,
        `- available_at_source: ${unavailableLabel(period.available_at_source)}`,
        `- retrieved_at: ${period.retrieved_at} (ingest clock, not publication)`,
        "",
        `| Line | Value |`,
        `| --- | --- |`,
        `| revenue | ${num(items?.revenue ?? null)} |`,
        `| pat | ${num(items?.pat ?? null)} |`,
        `| eps | ${num(items?.eps ?? null)} |`,
        `| equity | ${num(items?.equity ?? null)} |`,
        `| total_debt | ${num(items?.totalDebt ?? null)} |`,
        `| cash | ${num(items?.cash ?? null)} |`,
        `| ocf | ${num(items?.ocf ?? null)} |`,
        `| capex | ${num(items?.capex ?? null)} |`,
        `| dividend_per_share | ${num(items?.dividendPerShare ?? null)} |`,
        "",
      );
    }
  }

  sections.push(
    "## News & announcements",
    "",
    "Headlines are not facts. Classification is rule-based. Not a buy or sell list.",
    "",
  );
  if (payload.events.length === 0) {
    sections.push(
      "Data unavailable — no stored announcements. News weight is omitted from the Research Score (not scored as 50).",
      "",
    );
  } else {
    for (const event of payload.events) {
      sections.push(
        `### ${event.occurredAt} — ${event.headline}`,
        "",
        `- source: ${event.source}`,
        `- source_url: ${unavailableLabel(event.sourceUrl)}`,
        `- classification: ${event.classification}`,
        `- available_at: ${unavailableLabel(event.availableAt)}`,
        `- relevance: ${unavailableLabel(event.relevanceNote)}`,
        `- excerpt: ${unavailableLabel(event.excerpt)}`,
        "",
      );
    }
  }
  sections.push("Do not treat this document as a buy or sell instruction.", "");

  return sections.filter((line) => line !== undefined).join("\n");
}
