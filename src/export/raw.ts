import type { ExportPayload } from "@/export/payload";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/** Key tables as one CSV: factors, then financial periods. Empty numeric cells are blank (not zero). */
export function buildTablesCsv(payload: ExportPayload): string {
  const lines: string[] = [];
  lines.push(row(["table", "instrument_type", "profile", "ticker"]));
  lines.push(row(["meta", payload.instrument.instrument_type, payload.score.profile, payload.instrument.ticker]));
  lines.push(row(["dates", payload.dates.fundamentals_period, payload.dates.last_trade_date, payload.dates.score_as_of]));
  lines.push(
    row([
      "data_confidence",
      payload.score.dataConfidence.level,
      payload.score.dataCoverage.freshness,
      payload.score.dataCoverage.available,
      payload.score.dataCoverage.expected,
      payload.score.dataConfidence.needsVerification,
    ]),
  );
  lines.push("");
  lines.push(
    row([
      "table",
      "category",
      "factor_id",
      "label",
      "metric",
      "available",
      "value",
      "score",
      "coverage_category",
      "period",
      "formula",
      "reason",
    ]),
  );
  for (const category of payload.score.categories) {
    for (const factor of category.factors) {
      lines.push(
        row([
          "factor",
          category.id,
          factor.id,
          factor.label,
          factor.metricId,
          factor.available,
          factor.value,
          factor.score,
          category.coverage,
          factor.period,
          factor.formula,
          factor.reason,
        ]),
      );
    }
  }
  lines.push("");
  lines.push(
    row([
      "table",
      "period_end",
      "available_at",
      "statement_type",
      "source",
      "actual_or_estimate",
      "revenue",
      "pat",
      "eps",
      "equity",
      "total_debt",
      "cash",
      "ocf",
      "capex",
    ]),
  );
  for (const period of payload.financial_periods) {
    const items = period.line_items;
    lines.push(
      row([
        "financial_period",
        period.period_end,
        period.available_at,
        period.statement_type,
        period.source,
        period.actual_or_estimate,
        items?.revenue ?? "",
        items?.pat ?? "",
        items?.eps ?? "",
        items?.equity ?? "",
        items?.totalDebt ?? "",
        items?.cash ?? "",
        items?.ocf ?? "",
        items?.capex ?? "",
      ]),
    );
  }
  return lines.join("\n") + "\n";
}

export function buildRawJson(payload: ExportPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
