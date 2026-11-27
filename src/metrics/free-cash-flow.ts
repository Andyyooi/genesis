export function freeCashFlow(ocf: number | null | undefined, capex: number | null | undefined): number | null {
  if (ocf == null || capex == null || !Number.isFinite(ocf) || !Number.isFinite(capex)) return null;
  return ocf - Math.abs(capex);
}
