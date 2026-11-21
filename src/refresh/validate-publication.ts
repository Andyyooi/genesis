type Stage = { dataset: string; status: string; failed_count: number; started_at: string; attempted_count?: number };

export function validateRefreshStages(rows: Stage[], startedAt: string) {
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error("A valid REFRESH_STARTED_AT is required");
  for (const dataset of ["prices", "fundamentals", "fair_value"]) {
    const row = rows.find((stage) => stage.dataset === dataset);
    const allowed = dataset === "prices" ? ["SUCCESS", "UNCHANGED"] : ["SUCCESS", "UNCHANGED", "NO_DATA"];
    const tolerated = dataset === "fundamentals" && row?.status === "PARTIAL" && Number.isFinite(row.attempted_count) && row.attempted_count! > 0 && row.failed_count > 0 && row.failed_count / row.attempted_count! <= 0.05;
    if (!row || !Number.isFinite(Date.parse(row.started_at)) || Date.parse(row.started_at) < Date.parse(startedAt) || (!allowed.includes(row.status) && !tolerated) || (row.failed_count > 0 && !tolerated)) {
      throw new Error(`Refusing publication: ${dataset} refresh is missing, stale, partial or failed`);
    }
  }
}
