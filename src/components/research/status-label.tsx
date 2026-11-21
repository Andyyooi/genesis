export function StatusLabel({ level, children }: { level: string; children: React.ReactNode }) {
  const tone = ["HIGH", "FRESH", "eligible"].includes(level) ? "positive"
    : ["VERY_LOW", "VERY_STALE", "PN17"].includes(level) ? "negative"
    : ["LOW", "MEDIUM", "AGING", "STALE", "excluded"].includes(level) ? "caution" : "neutral";
  return <span className={`status-label status-${tone}`}>{children}</span>;
}
