import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parse } from "yaml";
import { POST } from "@/app/api/refresh/route";
import { GET } from "@/app/api/refresh/status/route";
import { mapRefreshStatus, resetGithubRefreshStateForTests, type WorkflowRun } from "@/refresh/github";
import { proxy } from "@/proxy";

const snapshot = vi.hoisted(() => ({ latestPriceDate: "2026-09-25", publishedAt: "2026-09-26T00:00:00Z" }));
vi.mock("@/refresh/deployed-snapshot", () => ({ deployedSnapshotState: () => ({ ...snapshot }) }));
const run: WorkflowRun = { id: 42, status: "in_progress", conclusion: null, created_at: "2026-10-01T10:00:00Z", run_started_at: "2026-10-01T10:01:00Z", updated_at: "2026-10-01T10:05:00Z", html_url: "https://github.com/Andyyooi/genesis/actions/runs/42" };
const request = (origin: string | null = "https://research.test") => new NextRequest("https://research.test/api/refresh", { method: "POST", headers: origin ? { origin } : {} });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  resetGithubRefreshStateForTests();
  snapshot.publishedAt = "2026-09-26T00:00:00Z";
  vi.stubEnv("GITHUB_REFRESH_TOKEN", "test-private-token");
  vi.stubEnv("GITHUB_REPO", "");
  vi.stubEnv("GITHUB_REFRESH_REF", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("GitHub refresh API", () => {
  it("dispatches the named workflow on main with a server-only bearer token", async () => {
    const fetch = vi.fn(async (_url: string, options: RequestInit) => options.method === "POST" ? new Response(null, { status: 204 }) : json({ workflow_runs: [] }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect((await response.json()).phase).toBe("queued");
    const dispatch = fetch.mock.calls.find(([, options]) => options.method === "POST")!;
    expect(dispatch[0]).toBe("https://api.github.com/repos/Andyyooi/genesis/actions/workflows/refresh-data.yml/dispatches");
    expect(JSON.parse(dispatch[1].body as string)).toEqual({ ref: "main" });
    expect(dispatch[1].headers).toMatchObject({ Authorization: "Bearer test-private-token" });
    expect((await POST(request())).status).toBe(409);
    expect(fetch.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it.each(["queued", "in_progress"])("returns 409 with existing %s status rather than dispatching", async (status) => {
    const fetch = vi.fn(async (url: string) => json({ workflow_runs: url.includes(`status=${status}`) ? [{ ...run, status }] : [] }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "already running", status, html_url: run.html_url });
    expect(fetch.mock.calls.every(([url]) => !url.includes("dispatches"))).toBe(true);
  });
  it("fails clearly without a token and performs no local refresh or network call", async () => {
    vi.stubEnv("GITHUB_REFRESH_TOKEN", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ configured: false, missing: ["GITHUB_REFRESH_TOKEN"], error: "Refresh isn't set up yet" });
    expect(await (await GET()).json()).toMatchObject({ configured: false, phase: "idle" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects absent and cross-site origins, and the proxy gates both routes", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request(null))).status).toBe(403);
    expect((await POST(request("https://evil.test"))).status).toBe(403);
    vi.stubEnv("SITE_PASSWORD", "test-password");
    for (const path of ["/api/refresh", "/api/refresh/status"]) expect((await proxy(new NextRequest(`https://research.test${path}`))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors repository/ref overrides and validates repository syntax", async () => {
    vi.stubEnv("GITHUB_REPO", "Andyyooi/example"); vi.stubEnv("GITHUB_REFRESH_REF", "release");
    const fetch = vi.fn(async (_url: string, options: RequestInit) => options.method === "POST" ? new Response(null, { status: 204 }) : json({ workflow_runs: [] }));
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request())).status).toBe(202);
    const dispatch = fetch.mock.calls.find(([, o]) => o.method === "POST")!;
    expect(dispatch[0]).toContain("/Andyyooi/example/"); expect(dispatch[1].body).toBe('{"ref":"release"}');
    vi.stubEnv("GITHUB_REPO", "../bad/path");
    expect((await POST(request())).status).toBe(503);
  });
  it("reads the current job step, caches GitHub for ten seconds, and reports elapsed time", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T10:06:00Z"));
    const fetch = vi.fn(async (url: string) => url.includes("/jobs?") ? json({ jobs: [{ status: "in_progress", steps: [{ name: "Re-score and publish universe results", status: "in_progress" }] }] }) : json({ workflow_runs: [run] }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await GET()).json()).toMatchObject({ phase: "rescoring", currentStep: "Re-score and publish universe results", elapsedSeconds: 300, startedAt: run.run_started_at, updatedAt: run.updated_at, html_url: run.html_url });
    await GET(); expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10001); await GET(); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("waits for the deployed publication, even on an unchanged price date", async () => {
    const fetch = vi.fn(async () => json({ workflow_runs: [{ ...run, status: "completed", conclusion: "success" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await GET()).json()).toMatchObject({ phase: "deploying", latestPriceDate: "2026-09-25" });
    snapshot.publishedAt = "2026-10-01T10:12:00Z";
    expect(await (await GET()).json()).toMatchObject({ phase: "done", latestPriceDate: "2026-09-25" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("handles an empty run history and GitHub failures without exposing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ workflow_runs: [] })));
    expect(await (await GET()).json()).toMatchObject({ phase: "idle", status: null, elapsedSeconds: 0 });
    resetGithubRefreshStateForTests();
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "test-private-token" }, 403)));
    const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("test-private-token");
    expect((await GET()).status).toBe(502);
  });
  it.each([
    ["queued", null, null, "queued"], ["in_progress", null, "Download prices and accounts; calculate fair value", "downloading"],
    ["in_progress", null, "Pack and validate snapshot", "publishing"], ["completed", "failure", null, "failed"],
    ["completed", "cancelled", null, "failed"], ["completed", "timed_out", null, "failed"],
  ])("maps %s/%s/%s to %s", (status, conclusion, step, phase) => {
    expect(mapRefreshStatus({ ...run, status: status!, conclusion }, step, snapshot).phase).toBe(phase);
  });

  it("schedules three weekday evening attempts in Malaysia time alongside workflow_dispatch", () => {
    const workflow = readFileSync(".github/workflows/refresh-data.yml", "utf8");
    expect(parse(workflow).on).toEqual({
      workflow_dispatch: null,
      schedule: [{ cron: "23 10 * * 1-5" }, { cron: "23 12 * * 1-5" }, { cron: "23 15 * * 1-5" }],
    });
  });
  it("uses the snapshot check to decide whether to run the refresh", () => {
    const workflow = parse(readFileSync(".github/workflows/refresh-data.yml", "utf8"));
    expect(workflow.jobs.check.outputs.run).toBe("${{ steps.snapshot.outputs.run }}");
    expect(workflow.jobs.refresh).toMatchObject({ needs: "check", if: "needs.check.outputs.run == 'true'" });
  });
});
