import type { EventSnapshot } from "@/metrics/types";

export function RecentEventsSection(props: { events: EventSnapshot[] }) {
  void props;
  return <section className="flex flex-col gap-3"><h2 className="text-xl font-semibold">News</h2><p className="text-sm text-muted-foreground">No news shown: we don&apos;t yet have a permitted news feed</p><p className="text-sm text-muted-foreground">Example and IR events are hidden and do not affect scores.</p></section>;
}
