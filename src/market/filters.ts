export function filterMarketRows<T extends Record<string, unknown>>(rows: T[], query = "", eligibility = "") {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => (!q || [row.ticker, row.name, row.sector].some((value) => String(value ?? "").toLowerCase().includes(q))) && (eligibility === "eligible" ? row.eligible === true : eligibility === "excluded" ? row.eligible !== true : true));
}
