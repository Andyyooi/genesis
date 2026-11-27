import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/publish-snapshot-data.sh");
const dirs: string[] = [];
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Snapshot test",
  GIT_AUTHOR_EMAIL: "snapshot@example.test",
  GIT_COMMITTER_NAME: "Snapshot test",
  GIT_COMMITTER_EMAIL: "snapshot@example.test",
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "snapshot-storage-"));
  dirs.push(root);
  const work = join(root, "work");
  const remote = join(root, "remote.git");
  mkdirSync(work);
  const run = (cwd: string, args: string[], input?: string) => execFileSync("git", args, {
    cwd, input, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  const git = (args: string[], input?: string) => run(work, args, input);
  const remoteGit = (...args: string[]) => run(remote, args);
  git(["init", "--initial-branch=main"]);
  git(["init", "--bare", "--initial-branch=main", remote]);
  git(["remote", "add", "origin", remote]);
  mkdirSync(join(work, "data", "snapshots"), { recursive: true });
  const artifact = join(work, "data", "snapshots", "research.db.gz");
  writeFileSync(artifact, "bootstrap snapshot");
  const blob = git(["hash-object", "-w", artifact]);
  const tree = git(["mktree"], `100644 blob ${blob}\tresearch.db.gz\n`);
  const initial = git(["commit-tree", tree, "-m", "bootstrap"]);
  git(["push", "origin", `${initial}:refs/heads/data-snapshot`]);
  const publishPointer = (commit: string) => {
    writeFileSync(join(work, "data", "snapshot.json"), JSON.stringify({ commit }));
    git(["add", "data/snapshot.json"]);
    git(["commit", "-m", "publish pointer"]);
    git(["push", "origin", "HEAD:main"]);
  };
  publishPointer(initial);
  const publishData = (contents: string) => {
    writeFileSync(artifact, contents);
    return execFileSync("bash", [script], { cwd: work, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  };
  const expectOrphan = (commit: string) => {
    const headers = remoteGit("cat-file", "-p", commit).split("\n\n")[0];
    expect(headers).not.toMatch(/^parent /m);
  };
  const expectPublished = (commit: string, contents: string) => {
    expectOrphan(commit);
    expect(remoteGit("ls-tree", "--name-only", commit)).toBe("research.db.gz\nvercel.json");
    expect(remoteGit("show", `${commit}:research.db.gz`)).toBe(contents);
    expect(JSON.parse(remoteGit("show", `${commit}:vercel.json`))).toEqual({ git: { deploymentEnabled: false } });
  };
  return { work, git, remoteGit, initial, publishPointer, publishData, expectOrphan, expectPublished };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("data branch publication", () => {
  it("retains only the current and previous single-commit snapshots across refreshes", () => {
    const { remoteGit, initial, publishPointer, publishData, expectPublished } = fixture();
    const first = publishData("first refresh");
    expect(remoteGit("rev-parse", "data-snapshot-previous")).toBe(initial);
    expectPublished(first, "first refresh");
    publishPointer(first);
    const second = publishData("second refresh");
    expect(remoteGit("rev-parse", "data-snapshot")).toBe(second);
    expect(remoteGit("rev-parse", "data-snapshot-previous")).toBe(first);
    expectPublished(second, "second refresh");
    expectPublished(first, "first refresh");
    expect(remoteGit("rev-parse", "--is-shallow-repository")).toBe("false");
    expect(remoteGit("rev-list", "--count", "data-snapshot", "data-snapshot-previous")).toBe("2");
  });

  it("preserves main's exact SHA when a pointer was not published, including on retry", () => {
    const { work, remoteGit, initial, publishData, expectOrphan, expectPublished } = fixture();
    const firstAttempt = publishData("first attempt");
    const retry = publishData("retry without a successful pointer push");
    expect(retry).not.toBe(firstAttempt);
    expect(JSON.parse(readFileSync(join(work, "data", "snapshot.json"), "utf8")).commit).toBe(initial);
    expect(JSON.parse(remoteGit("show", "main:data/snapshot.json")).commit).toBe(initial);
    expect(remoteGit("rev-parse", "data-snapshot-previous")).toBe(initial);
    expect(remoteGit("rev-parse", "data-snapshot")).toBe(retry);
    expectPublished(retry, "retry without a successful pointer push");
    expectOrphan(initial);
    expect(remoteGit("ls-tree", "--name-only", initial)).toBe("research.db.gz");
  });

  it("refuses to change data refs if main moved during the refresh", () => {
    const { git, remoteGit, initial, publishData } = fixture();
    const nextMain = git(["commit-tree", git(["rev-parse", "HEAD^{tree}"]), "-p", "HEAD", "-m", "intervening main change"]);
    git(["push", "origin", `${nextMain}:main`]);
    expect(() => publishData("not published")).toThrow("main changed during refresh");
    expect(remoteGit("rev-parse", "data-snapshot")).toBe(initial);
    expect(remoteGit("for-each-ref", "--format=%(refname)", "refs/heads/data-snapshot-previous")).toBe("");
  });
});
