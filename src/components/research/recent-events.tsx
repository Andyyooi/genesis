import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateSafe } from "@/lib/display";
import { isFixtureEvent } from "@/lib/research-presentation";
import type { EventSnapshot } from "@/metrics/types";

export function RecentEventsSection({ events }: { events: EventSnapshot[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Recent Events</h2>
        <p className="text-sm text-muted-foreground">
          Stored company events only. Not scraped when you open this page. Labels are rule-based,
          not recommendations. Events do not change Research Score or Absolute Valuation Score.
        </p>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Unavailable — no stored events for this name.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Headline</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead>Materiality</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event, index) => {
              const fixture = isFixtureEvent(event);
              const when = formatDateSafe(event.publishedAt ?? event.occurredAt);
              return (
                <TableRow key={`${event.sourceId ?? event.occurredAt}-${index}`}>
                  <TableCell className="whitespace-nowrap">{when}</TableCell>
                  <TableCell className="whitespace-nowrap">{event.eventType ?? "UNKNOWN"}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {event.sourceUrl ? (
                        <a
                          href={event.sourceUrl}
                          className="underline underline-offset-4"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {event.headline}
                        </a>
                      ) : (
                        event.headline
                      )}
                      {fixture ? (
                        <Badge variant="outline" className="w-fit text-xs font-normal">
                          Fixture / curated
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{event.source}</TableCell>
                  <TableCell>{event.sentiment ?? event.classification ?? "UNKNOWN"}</TableCell>
                  <TableCell>{event.materiality ?? "UNKNOWN"}</TableCell>
                  <TableCell>{event.eventConfidence ?? "UNKNOWN"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
