import { describe, expect, it } from "vitest";
import { isSnapshotReadOnly, refuseSnapshotWrites } from "@/lib/data-mode";

describe("data mode", () => {
  it("is writable in the default local process", () => {
    expect(isSnapshotReadOnly()).toBe(false);
    expect(refuseSnapshotWrites("test")).toBe(false);
  });
});
