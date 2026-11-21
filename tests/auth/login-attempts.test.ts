import { describe, expect, it } from "vitest";
import { createLoginAttemptLimiter } from "@/auth/login-attempts";

describe("login failure limits", () => {
  it("limits five failures per IP for 15 minutes and permits other IPs", () => {
    const limiter = createLoginAttemptLimiter();
    for (let i = 0; i < 5; i++) {
      const attempt = limiter.begin("one", 0);
      expect(attempt.allowed).toBe(true);
      if (attempt.allowed) attempt.finish(false);
    }
    expect(limiter.begin("one", 1)).toMatchObject({ allowed: false, retryAfter: 900 });
    expect(limiter.begin("two", 1).allowed).toBe(true);
    expect(limiter.begin("one", 900000).allowed).toBe(true);
  });
  it("reserves concurrent attempts, does not count successful guesses and bounds global failures", () => {
    const limiter = createLoginAttemptLimiter();
    for (let i = 0; i < 10; i++) {
      const attempt = limiter.begin("valid", 0);
      if (attempt.allowed) attempt.finish(true);
    }
    const pending = Array.from({ length: 5 }, () => limiter.begin("pending", 0));
    expect(limiter.begin("pending", 0).allowed).toBe(false);
    pending.forEach((attempt) => { if (attempt.allowed) attempt.finish(true); });
    expect(limiter.begin("pending", 0).allowed).toBe(true);
    for (let i = 0; i < 99; i++) {
      const attempt = limiter.begin(String(i), 0);
      if (attempt.allowed) attempt.finish(false);
    }
    expect(limiter.begin("new", 0).allowed).toBe(false);
    expect(limiter.begin("new", 900000).allowed).toBe(true);
  });
});
