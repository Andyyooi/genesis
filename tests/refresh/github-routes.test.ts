import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parse } from "yaml";
import { GET as CRON_GET } from "@/app/api/cron/refresh/route";
import { POST } from "@/app/api/refresh/route";
import { GET } from "@/app/api/refresh/status/route";
import { isPublishedAfterMalaysiaEveningCutoff, mapRefreshStatus, resetGithubRefreshStateForTests, type WorkflowRun } from "@/refresh/github";
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
    const fetch = vi.fn(async (url: string) => url.includes("/jobs?")
      ? json({ jobs: [{ name: "check", status: "completed", conclusion: "skipped" }, { name: "refresh", status: "completed", conclusion: "success" }] })
      : json({ workflow_runs: [{ ...run, status: "completed", conclusion: "success" }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await (await GET()).json()).toMatchObject({ phase: "deploying", latestPriceDate: "2026-09-25" });
    snapshot.publishedAt = "2026-10-01T10:12:00Z";
    expect(await (await GET()).json()).toMatchObject({ phase: "done", latestPriceDate: "2026-09-25" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([true, false])("ignores completed retries that skipped refresh (prior refresh: %s)", async (hasRefresh) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T15:24:00Z"));
    snapshot.publishedAt = "2026-10-01T10:12:00Z";
    const completed = { ...run, status: "completed", conclusion: "success" };
    const retries = [15, 12].map((hour, i) => ({
      ...completed, id: 44 - i, created_at: `2026-10-01T${hour}:23:00Z`,
      run_started_at: `2026-10-01T${hour}:23:00Z`, updated_at: `2026-10-01T${hour}:24:00Z`,
      html_url: `https://github.com/Andyyooi/genesis/actions/runs/${44 - i}`,
    }));
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/jobs?")) {
        return json({ jobs: [{ name: "refresh", status: "completed", conclusion: url.includes(`/runs/${run.id}/`) ? "success" : "skipped" }] });
      }
      return json({ workflow_runs: hasRefresh ? [...retries, completed] : retries });
    });
    vi.stubGlobal("fetch", fetch);
    const expected = hasRefresh ? { phase: "done", html_url: run.html_url } : { phase: "idle", html_url: null };
    expect(await (await GET()).json()).toMatchObject(expected);
    expect(fetch).toHaveBeenCalledTimes(hasRefresh ? 4 : 3);
    vi.advanceTimersByTime(10001);
    expect(await (await GET()).json()).toMatchObject(expected);
    expect(fetch).toHaveBeenCalledTimes(hasRefresh ? 5 : 4);
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

  it("schedules three weekday evening fallback attempts alongside workflow_dispatch source input", () => {
    const workflow = readFileSync(".github/workflows/refresh-data.yml", "utf8");
    expect(parse(workflow).on).toMatchObject({
      workflow_dispatch: {
        inputs: {
          source: { required: false, default: "manual", type: "choice", options: ["manual", "scheduled"] },
        },
      },
      schedule: [{ cron: "23 10 * * 1-5" }, { cron: "23 12 * * 1-5" }, { cron: "23 15 * * 1-5" }],
    });
  });
  it("uses the snapshot check to decide whether to run scheduled refreshes", () => {
    const workflow = parse(readFileSync(".github/workflows/refresh-data.yml", "utf8"));
    expect(workflow.jobs.check.outputs.run).toBe("${{ steps.snapshot.outputs.run }}");
    expect(workflow.jobs.check.steps[0].if).toBe("github.event_name == 'schedule' || inputs.source == 'scheduled'");
    expect(workflow.jobs.refresh).toMatchObject({ needs: "check", if: "needs.check.outputs.run == 'true'" });
  });
  it("configures weekday after-close Vercel cron jobs in vercel.json", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(config.crons).toEqual([
      { path: "/api/cron/refresh", schedule: "15 10 * * 1-5" },
      { path: "/api/cron/refresh", schedule: "15 12 * * 1-5" },
    ]);
  });
  it("detects snapshots published at or after 6:00 PM Malaysia time on the same day", () => {
    const now = Date.parse("2026-11-27T10:15:00Z"); // 18:15 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff("2026-11-27T10:00:00Z", now)).toBe(true); // 18:00 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff("2026-11-27T10:05:00Z", now)).toBe(true); // 18:05 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff("2026-11-27T09:59:59Z", now)).toBe(false); // 17:59:59 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff("2026-11-27T01:20:33Z", now)).toBe(false); // 09:20 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff("2026-11-26T11:00:00Z", now)).toBe(false); // yesterday 19:00 MYT
    expect(isPublishedAfterMalaysiaEveningCutoff(null, now)).toBe(false);
    expect(isPublishedAfterMalaysiaEveningCutoff("invalid", now)).toBe(false);
  });
  it("authenticates Vercel cron with CRON_SECRET and dispatches scheduled workflow runs", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-27T10:15:00Z"));
    snapshot.publishedAt = "2026-11-27T01:20:33Z";
    const cronReq = (auth?: string) => new NextRequest("https://research.test/api/cron/refresh", {
      method: "GET", headers: auth ? { authorization: auth } : {},
    });
    const fetch = vi.fn(async (_url: string, options: RequestInit) => options.method === "POST" ? new Response(null, { status: 204 }) : json({ workflow_runs: [] }));
    vi.stubGlobal("fetch", fetch);

    vi.stubEnv("CRON_SECRET", "");
    expect((await CRON_GET(cronReq("Bearer any"))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", "super-secret-cron-token");
    expect((await CRON_GET(cronReq())).status).toBe(401);
    expect((await CRON_GET(cronReq("Bearer wrong-token"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();

    const dispatched = await CRON_GET(cronReq("Bearer super-secret-cron-token"));
    expect(dispatched.status).toBe(202);
    const dispatch = fetch.mock.calls.find(([, o]) => o.method === "POST")!;
    expect(JSON.parse(dispatch[1].body as string)).toEqual({ ref: "main", inputs: { source: "scheduled" } });

    const alreadyRunning = await CRON_GET(cronReq("Bearer super-secret-cron-token"));
    expect(alreadyRunning.status).toBe(200);
    expect(await alreadyRunning.json()).toMatchObject({ skipped: true, reason: "already_running" });

    resetGithubRefreshStateForTests();
    fetch.mockClear();
    snapshot.publishedAt = "2026-11-27T10:05:00Z"; // 18:05 MYT
    const skipped = await CRON_GET(cronReq("Bearer super-secret-cron-token"));
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({ skipped: true, reason: "already_published_today" });
    expect(fetch).not.toHaveBeenCalled();

    vi.stubEnv("SITE_PASSWORD", "test-password");
    expect((await proxy(new NextRequest("https://research.test/api/cron/refresh", { method: "GET" }))).status).toBe(200);
    expect((await proxy(new NextRequest("https://research.test/api/cron/refresh", { method: "POST" }))).status).toBe(401);
  });
});
