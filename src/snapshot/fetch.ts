import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SnapshotPointer = {
  commit: string;
  sha256: string;
  bytes: number;
  publishedAt: string;
  priceDate: string;
};

export function parseSnapshotPointer(value: unknown): SnapshotPointer {
  const pointer = value as Partial<SnapshotPointer> | null;
  if (
    !pointer ||
    typeof pointer.commit !== "string" || !/^[a-f0-9]{40}$/.test(pointer.commit) ||
    typeof pointer.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pointer.sha256) ||
    typeof pointer.bytes !== "number" || !Number.isSafeInteger(pointer.bytes) || pointer.bytes <= 0 ||
    typeof pointer.publishedAt !== "string" || !Number.isFinite(Date.parse(pointer.publishedAt)) ||
    typeof pointer.priceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pointer.priceDate) ||
    !Number.isFinite(Date.parse(pointer.priceDate)) ||
    new Date(pointer.priceDate).toISOString().slice(0, 10) !== pointer.priceDate
  ) {
    throw new Error("Invalid snapshot pointer in data/snapshot.json");
  }
  return pointer as SnapshotPointer;
}

async function fileStat(path: string) {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function fetchSnapshot({
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  onlyIfMissing = false,
}: {
  root?: string;
  fetchImpl?: typeof fetch;
  onlyIfMissing?: boolean;
} = {}): Promise<"present" | "verified" | "downloaded"> {
  const target = join(root, "data", "snapshots", "research.db.gz");
  const existing = await fileStat(target);
  if (onlyIfMissing && existing?.isFile()) return "present";

  const pointer = parseSnapshotPointer(JSON.parse(await readFile(join(root, "data", "snapshot.json"), "utf8")));
  if (existing?.isFile() && existing.size === pointer.bytes) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    if (hash.digest("hex") === pointer.sha256) return "verified";
  }

  const partial = `${target}.${randomUUID()}.partial`;
  try {
    const response = await fetchImpl(
      `https://raw.githubusercontent.com/Andyyooi/genesis/${pointer.commit}/research.db.gz`,
      { signal: AbortSignal.timeout(120_000), redirect: "error" },
    );
    if (!response.ok || !response.body) {
      throw new Error(`Snapshot download failed: HTTP ${response.status} or empty response`);
    }
    await mkdir(dirname(target), { recursive: true });
    const output = await open(partial, "wx");
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > pointer.bytes) throw new Error("Snapshot size mismatch: download exceeds pointer size");
        hash.update(value);
        await output.writeFile(value);
      }
      await output.sync();
    } finally {
      await output.close();
      await reader.cancel().catch(() => {});
    }
    if (bytes !== pointer.bytes) throw new Error(`Snapshot size mismatch: expected ${pointer.bytes}, received ${bytes}`);
    if (hash.digest("hex") !== pointer.sha256) throw new Error("Snapshot SHA-256 checksum mismatch");
    await rename(partial, target);
    return "downloaded";
  } finally {
    await rm(partial, { force: true });
  }
}
