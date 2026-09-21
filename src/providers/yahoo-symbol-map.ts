/** Systematic Yahoo / Bursa symbol candidates. Does not invent a second universe. */

export function yahooSymbolCandidates(instrument: {
  yahooTicker?: string | null;
  bursaCode?: string | null;
  ticker?: string | null;
}): string[] {
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const trimmed = raw.trim().toUpperCase();
    if (!trimmed) return;
    const withKl = trimmed.endsWith(".KL") ? trimmed : `${trimmed.replace(/\.KL$/i, "")}.KL`;
    if (!out.includes(withKl)) out.push(withKl);
  };
  push(instrument.yahooTicker);
  push(instrument.bursaCode);
  const ticker = instrument.ticker?.trim().toUpperCase() ?? "";
  if (/^[0-9]{3,5}[A-Z]{0,2}$/.test(ticker)) push(ticker);
  return out;
}
