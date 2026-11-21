type Bucket = { failures: number; pending: number; expires: number };

export function createLoginAttemptLimiter() {
  const duration = 15 * 60 * 1000;
  const buckets = new Map<string, Bucket>();
  let global: Bucket = { failures: 0, pending: 0, expires: 0 };
  return {
    begin(ip: string, now = Date.now()) {
      for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
      if (global.expires <= now) global = { failures: 0, pending: 0, expires: now + duration };
      const total = global;
      let bucket = buckets.get(ip);
      if (!bucket) {
        if (buckets.size >= 10000) return { allowed: false as const, retryAfter: 900 };
        bucket = { failures: 0, pending: 0, expires: now + duration };
        buckets.set(ip, bucket);
      }
      const blocked = bucket.failures + bucket.pending >= 5 ? bucket : total.failures + total.pending >= 100 ? total : null;
      if (blocked) return { allowed: false as const, retryAfter: Math.max(1, Math.ceil((blocked.expires - now) / 1000)) };
      const current = bucket;
      current.pending += 1; total.pending += 1;
      let finished = false;
      return { allowed: true as const, finish(success: boolean) {
        if (finished) return;
        finished = true;
        current.pending -= 1; total.pending -= 1;
        if (success) current.failures = 0;
        else { current.failures += 1; total.failures += 1; }
      } };
    },
  };
}

// Best-effort only on serverless: counters are per warm instance and reset on restart.
export const loginAttemptLimiter = createLoginAttemptLimiter();
