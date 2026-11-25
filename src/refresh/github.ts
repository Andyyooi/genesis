export type RefreshPhase = "idle" | "queued" | "downloading" | "rescoring" | "publishing" | "deploying" | "done" | "failed";
export type WorkflowRun = {
  id: number; status: string; conclusion: string | null; created_at: string;
  run_started_at: string | null; updated_at: string; html_url: string;
};
type Job = { status: string; steps?: { name: string; status: string }[] };
export type RefreshStatus = {
  configured: boolean; missing: string[]; phase: RefreshPhase; status: string | null;
  conclusion: string | null; startedAt: string | null; updatedAt: string | null;
  html_url: string | null; currentStep: string | null; elapsedSeconds: number;
  latestPriceDate: string | null; publishedAt: string | null;
};
export type SnapshotState = { latestPriceDate: string | null; publishedAt: string | null };
const workflow = "refresh-data.yml";
const active = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
let cache: { key: string; until: number; run: WorkflowRun | null; step: string | null } | null = null;
let dispatchLock: { key: string; until: number } | null = null;

export function refreshConfiguration() {
  const token = process.env.GITHUB_REFRESH_TOKEN?.trim();
  const repo = process.env.GITHUB_REPO?.trim() || "Andyyooi/genesis";
  const ref = process.env.GITHUB_REFRESH_REF?.trim() || "main";
  const missing = !token ? ["GITHUB_REFRESH_TOKEN"] : [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) missing.push("GITHUB_REPO (owner/repository)");
  return { token, repo, ref, missing };
}

async function github(path: string, method = "GET", body?: unknown) {
  const config = refreshConfiguration();
  const response = await fetch(`https://api.github.com/repos/${config.repo}${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}. Check the refresh token, workflow and repository permissions.`);
  return response.status === 204 ? null : response.json();
}

export function mapRefreshStatus(run: WorkflowRun | null, step: string | null, snapshot: SnapshotState, now = Date.now()): RefreshStatus {
  let phase: RefreshPhase = "idle";
  const startedAt = run?.run_started_at ?? run?.created_at ?? null;
  if (run) {
    if (run.status === "completed") {
      phase = run.conclusion === "success"
        ? snapshot.publishedAt && Date.parse(snapshot.publishedAt) >= Date.parse(startedAt!) ? "done" : "deploying"
        : "failed";
    } else if (run.status !== "in_progress") phase = "queued";
    else if (/re.scor/i.test(step ?? "")) phase = "rescoring";
    else if (/publish|pack|commit|push|upload|post |validate refresh/i.test(step ?? "")) phase = "publishing";
    else phase = "downloading";
  }
  const end = run?.status === "completed" ? Date.parse(run.updated_at) : now;
  return {
    configured: true, missing: [], phase, status: run?.status ?? null, conclusion: run?.conclusion ?? null,
    startedAt, updatedAt: run?.updated_at ?? null, html_url: run?.html_url ?? null, currentStep: step,
    elapsedSeconds: startedAt ? Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000)) : 0, ...snapshot,
  };
}

export async function getRefreshStatus(snapshot: SnapshotState): Promise<RefreshStatus> {
  const config = refreshConfiguration();
  if (config.missing.length) return { ...mapRefreshStatus(null, null, snapshot), configured: false, missing: config.missing };
  const key = `${config.repo}:${config.ref}:${config.token}`;
  if (!cache || cache.key !== key || Date.now() >= cache.until) {
    const data = await github(`/actions/workflows/${workflow}/runs?per_page=100`);
    const runs: WorkflowRun[] = data.workflow_runs;
    const run = runs.find((r) => active.has(r.status)) ?? runs[0] ?? null;
    let step: string | null = null;
    if (run?.status === "in_progress") {
      const jobs: { jobs: Job[] } = await github(`/actions/runs/${run.id}/jobs?per_page=100`);
      step = jobs.jobs.flatMap((job) => job.steps ?? []).find((s) => s.status === "in_progress")?.name ?? null;
    }
    cache = { key, until: Date.now() + 10000, run, step };
  }
  return mapRefreshStatus(cache.run, cache.step, snapshot);
}

export async function dispatchRefresh(snapshot: SnapshotState): Promise<{ status: number; body: RefreshStatus & { error?: string } }> {
  const config = refreshConfiguration();
  if (config.missing.length) return { status: 503, body: { ...mapRefreshStatus(null, null, snapshot), configured: false, missing: config.missing, error: "Refresh isn't set up yet" } };
  const key = `${config.repo}:${config.token}`;
  if (dispatchLock?.key === key && dispatchLock.until > Date.now()) return { status: 409, body: { ...mapRefreshStatus(null, null, snapshot), phase: "queued", status: "queued", error: "already running" } };
  dispatchLock = { key, until: Date.now() + 30000 };
  try {
    const pending = await Promise.all(["queued", "in_progress", "waiting", "pending", "requested"].map(async (status) => {
      const data = await github(`/actions/workflows/${workflow}/runs?status=${status}&per_page=1`);
      return data.workflow_runs[0] as WorkflowRun | undefined;
    }));
    const running = pending.find(Boolean);
    if (running) {
      dispatchLock = null;
      return { status: 409, body: { ...mapRefreshStatus(running, null, snapshot), error: "already running" } };
    }
    await github(`/actions/workflows/${workflow}/dispatches`, "POST", { ref: config.ref });
    cache = null;
    return { status: 202, body: { ...mapRefreshStatus(null, null, snapshot), phase: "queued", status: "queued", startedAt: new Date().toISOString() } };
  } catch (error) {
    dispatchLock = null;
    throw error;
  }
}

export function resetGithubRefreshStateForTests() { cache = null; dispatchLock = null; }
