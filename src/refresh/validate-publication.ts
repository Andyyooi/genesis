type Stage = { dataset: string; status: string; failed_count: number; started_at: string; requested_succeeded_count?: number | null; never_available_count?: number | null };

export function validateRefreshStages(rows: Stage[], startedAt: string) {
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error("A valid REFRESH_STARTED_AT is required");
  for (const dataset of ["prices", "fundamentals", "fair_value"]) {
    const row = rows.find((stage) => stage.dataset === dataset);
    const allowed = dataset === "prices" ? ["SUCCESS", "UNCHANGED"] : ["SUCCESS", "UNCHANGED", "NO_DATA"];
    let usable = !!row && allowed.includes(row.status) && row.failed_count === 0;
    if (row && dataset !== "fair_value") {
      const succeeded = row.requested_succeeded_count ?? -1;
      const neverAvailable = dataset === "fundamentals" ? (row.never_available_count ?? 0) : 0;
      const failed = row.failed_count - neverAvailable;
      const requested = succeeded + failed;
      const validCounts = Number.isSafeInteger(succeeded) && succeeded >= 0 && Number.isSafeInteger(failed) && failed >= 0 && Number.isSafeInteger(neverAvailable) && neverAvailable >= 0;
      const validStatus = row.failed_count > 0 ? row.status === "PARTIAL" : allowed.includes(row.status);
      usable = validCounts && validStatus && (requested === 0 || (succeeded > 0 && failed / requested <= 0.05));
    }
    if (!row || !Number.isFinite(Date.parse(row.started_at)) || Date.parse(row.started_at) < Date.parse(startedAt) || !usable) {
      throw new Error(`Refusing publication: ${dataset} refresh is missing, stale, failed or exceeds the request failure tolerance`);
    }
  }
}
