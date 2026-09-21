import { CATEGORY_LABELS, formatScore100, scoreNarrative, strongestPositives } from "@/lib/research-copy";
import type { ExportPayload } from "@/export/payload";

export function buildQuickMarkdown(payload: ExportPayload): string {
  const { instrument, score } = payload;
  const positives = strongestPositives(score);
  const lines = [
    `# ${instrument.ticker} — ${instrument.name}`,
    "",
    payload.disclaimer,
    "",
    `- instrument_type: ${instrument.instrument_type}`,
    `- scoring profile: ${score.profile}`,
    `- PN17: ${instrument.pn17 ? "yes — higher-risk status warning" : "no"}`,
    `- asOf: ${score.asOf}`,
    `- fundamentals period: ${payload.dates.fundamentals_period ?? "Data unavailable"}`,
    `- price as-of / last trade: ${payload.dates.last_trade_date ?? "Data unavailable"}`,
    "",
    payload.dates.lag_note,
    `**Research Score:** ${formatScore100(score.researchScore)}`,
    `**Valuation Score:** ${formatScore100(score.valuationScore)} (valuation factors only; not a copy of Research Score)`,
    `**Data Confidence:** ${score.dataConfidence.level}${score.dataConfidence.needsVerification ? " — High score — needs verification" : ""}`,
    `**Data freshness:** ${score.dataCoverage.freshness} · core coverage ${score.dataCoverage.available}/${score.dataCoverage.expected}`,
    "",
    scoreNarrative(score),
    "",
    "## Category snapshot",
    ...score.categories.map(
      (c) =>
        `- ${CATEGORY_LABELS[c.id] ?? c.id}: ${formatScore100(c.score)} · coverage ${(c.coverage * 100).toFixed(0)}% · ${c.inThisRun ? "in this run" : "not in this run"}`,
    ),
    "",
    "## Why it is interesting",
    positives.length
      ? positives.map((f) => `- ${f.label}: ${formatScore100(f.score)} (${f.period ?? "Data unavailable"})`).join("\n")
      : "No factor scored 60 or above.",
    "",
    "## Potential Concerns",
    score.concerns.length
      ? score.concerns.map((c) => `- ${c.label}: ${c.message}`).join("\n")
      : "No concern rules fired. This is not a clean bill of health.",
    "",
    "News and technical categories are configured but not in this live run. Full evidence is in the Full Research Report.",
    "",
  ];
  return lines.join("\n");
}
