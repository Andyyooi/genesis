import type { EventSnapshot } from "@/metrics/types";

/**
 * Point-in-time filter for events.
 * published_at / available_at known → usable when <= asOf.
 * available_at null and published unknown → NOT PIT-safe (excluded when requirePitSafe).
 */
export function filterEventsAsOf(
  events: Array<
    EventSnapshot & {
      publishedAt?: string | null;
      availableAt: string | null;
      occurredAt: string;
    }
  >,
  asOf: string,
  opts?: { requirePitSafe?: boolean },
): typeof events {
  const requirePitSafe = opts?.requirePitSafe ?? false;
  return events.filter((event) => {
    if (event.availableAt) return event.availableAt <= asOf;
    if (requirePitSafe) return false;
    // Legacy Phase 8 fallback: occurred_at only when available_at missing (not PIT-safe for backtests).
    return event.occurredAt <= asOf;
  });
}

export function isPitSafeEvent(event: { availableAt: string | null; publishedAt?: string | null }): boolean {
  return Boolean(event.availableAt ?? event.publishedAt);
}
