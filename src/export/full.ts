import { CATEGORY_LABELS, formatScore100, scoreNarrative, strongestPositives } from "@/lib/research-copy";
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
    `| Scoring profile | ${score.profile} |`,
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
      "This export uses the **REIT** factor profile (distribution yield, DPU CAGR, gearing). Industrial FCF, net debt/EBITDA, and ordinary-company P/E are not scoring factors.",
      "",
    );
  }

  sections.push(
    "## Scores",
    "",
    `- Research Score: ${formatScore100(score.researchScore)}`,
    `- Valuation Score: ${formatScore100(score.valuationScore)} (valuation factors only)`,
    "",
    scoreNarrative(score),
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
    "Amounts are as stored (MYR). Blank source cells were not invented. `available_at` is publication time when known.",
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
        `- available_at: ${unavailableLabel(period.available_at)}`,
        `- retrieved_at: ${period.retrieved_at}`,
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
    "Data unavailable — news ingest is not in this phase. The news category is configured but not in this live Research Score.",
    "",
    "Do not treat this document as a buy or sell instruction.",
    "",
  );

  return sections.filter((line) => line !== undefined).join("\n");
}
