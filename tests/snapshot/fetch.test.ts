import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSnapshot, parseSnapshotPointer } from "@/snapshot/fetch";

const artifact = gzipSync("snapshot fixture");
const pointer = {
  commit: "a".repeat(40),
  sha256: createHash("sha256").update(artifact).digest("hex"),
  bytes: artifact.length,
  publishedAt: "2026-11-21T00:00:00.000Z",
  priceDate: "2026-09-25",
};
const dirs: string[] = [];

async function fixture(overrides: Record<string, unknown> = {}, local?: Buffer) {
  const root = await mkdtemp(join(tmpdir(), "snapshot-fetch-"));
  dirs.push(root);
  await mkdir(join(root, "data", "snapshots"), { recursive: true });
  await writeFile(join(root, "data", "snapshot.json"), JSON.stringify({ ...pointer, ...overrides }));
  const target = join(root, "data", "snapshots", "research.db.gz");
  if (local) await writeFile(target, local);
  return { root, target };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("snapshot download", () => {
  it("downloads by immutable commit, verifies and writes the full artifact", async () => {
    const { root, target } = await fixture();
    const fetchImpl = vi.fn(async () => new Response(artifact));
    expect(await fetchSnapshot({ root, fetchImpl })).toBe("downloaded");
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/Andyyooi/genesis/${pointer.commit}/research.db.gz`,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    expect(await readFile(target)).toEqual(artifact);
    expect(await readdir(join(root, "data", "snapshots"))).toEqual(["research.db.gz"]);
  });

  it("skips the network when the existing size and checksum match", async () => {
    const { root } = await fixture({}, artifact);
    const fetchImpl = vi.fn();
    expect(await fetchSnapshot({ root, fetchImpl })).toBe("verified");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("replaces a same-size corrupt local file only after a valid download", async () => {
    const corrupt = Buffer.alloc(artifact.length);
    const { root, target } = await fixture({}, corrupt);
    const fetchImpl = vi.fn(async () => {
      expect(await readFile(target)).toEqual(corrupt);
      return new Response(artifact);
    });
    expect(await fetchSnapshot({ root, fetchImpl })).toBe("downloaded");
    expect(await readFile(target)).toEqual(artifact);
  });

  it("rejects a checksum mismatch without installing a target or leaving partial files", async () => {
    const { root, target } = await fixture({ sha256: "0".repeat(64) });
    await expect(fetchSnapshot({ root, fetchImpl: async () => new Response(artifact) })).rejects.toThrow("checksum mismatch");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(root, "data", "snapshots"))).toEqual([]);
  });

  it("preserves an existing file when replacement verification fails", async () => {
    const original = Buffer.from("previous local snapshot");
    const { root, target } = await fixture({ sha256: "0".repeat(64) }, original);
    await expect(fetchSnapshot({ root, fetchImpl: async () => new Response(artifact) })).rejects.toThrow("checksum mismatch");
    expect(await readFile(target)).toEqual(original);
    expect(await readdir(join(root, "data", "snapshots"))).toEqual(["research.db.gz"]);
  });

  it.each([artifact.length - 1, artifact.length + 1, 0])("rejects a response with %i bytes", async (size) => {
    const { root } = await fixture();
    await expect(fetchSnapshot({ root, fetchImpl: async () => new Response(Buffer.alloc(size)) })).rejects.toThrow("size mismatch");
    expect(await readdir(join(root, "data", "snapshots"))).toEqual([]);
  });

  it("fails loudly on HTTP and network errors", async () => {
    const { root } = await fixture();
    await expect(fetchSnapshot({ root, fetchImpl: async () => new Response("Not found", { status: 404 }) })).rejects.toThrow("HTTP 404");
    await expect(fetchSnapshot({ root, fetchImpl: async () => { throw new Error("network unavailable"); } })).rejects.toThrow("network unavailable");
    expect(await readdir(join(root, "data", "snapshots"))).toEqual([]);
  });

  it("cleans up an interrupted streaming download", async () => {
    const { root } = await fixture();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(artifact.subarray(0, 4));
        else controller.error(new Error("connection interrupted"));
      },
    });
    await expect(fetchSnapshot({ root, fetchImpl: async () => new Response(body) })).rejects.toThrow("connection interrupted");
    expect(await readdir(join(root, "data", "snapshots"))).toEqual([]);
  });

  it("preserves an existing dev copy without fetching when only-if-missing is used", async () => {
    const { root, target } = await fixture({}, Buffer.from("local dev snapshot"));
    const fetchImpl = vi.fn();
    expect(await fetchSnapshot({ root, fetchImpl, onlyIfMissing: true })).toBe("present");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(target, "utf8")).toBe("local dev snapshot");
  });

  it("fetches a missing dev copy", async () => {
    const { root } = await fixture();
    expect(await fetchSnapshot({ root, onlyIfMissing: true, fetchImpl: async () => new Response(artifact) })).toBe("downloaded");
  });

  it("rejects malformed metadata before calling fetch", async () => {
    const { root } = await fixture({ commit: "main" });
    const fetchImpl = vi.fn();
    await expect(fetchSnapshot({ root, fetchImpl })).rejects.toThrow("Invalid snapshot pointer");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("snapshot pointer validation", () => {
  it("accepts a complete pointer", () => {
    expect(parseSnapshotPointer(pointer)).toEqual(pointer);
  });

  it.each([
    null, {}, { ...pointer, commit: "data-snapshot" }, { ...pointer, sha256: "xyz" },
    { ...pointer, bytes: 0 }, { ...pointer, bytes: -1 }, { ...pointer, bytes: 1.5 },
    { ...pointer, bytes: "100" }, { ...pointer, bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...pointer, publishedAt: "invalid" }, { ...pointer, priceDate: "2026-02-30" },
    { ...pointer, priceDate: null },
  ])("rejects invalid metadata %#", (value) => {
    expect(() => parseSnapshotPointer(value)).toThrow("Invalid snapshot pointer");
  });
});
