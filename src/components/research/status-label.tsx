export function StatusLabel({ level, children }: { level: string | null | undefined; children: React.ReactNode }) {
  const value = level ?? "UNKNOWN";
  const tone = ["HIGH", "FRESH", "eligible"].includes(value) ? "positive"
    : ["VERY_LOW", "VERY_STALE", "PN17"].includes(value) ? "negative"
    : ["LOW", "MEDIUM", "AGING", "STALE", "excluded"].includes(value) ? "caution" : "neutral";
  return <span className={`status-label status-${tone}`}>{children}</span>;
}
