import Link from "next/link";

export type AlertRow = {
  id: number;
  ticker: string;
  name: string;
  ruleId: string;
  title: string;
  why: string;
  href: string;
  triggeredAt: string;
};

export function AlertsList({ rows, empty }: { rows: AlertRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {row.triggeredAt.slice(0, 19).replace("T", " ")} · {row.ruleId} · {row.ticker}
          </p>
          <p className="font-medium">
            <Link href={row.href} className="underline underline-offset-4">
              {row.title}
            </Link>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{row.why}</p>
        </li>
      ))}
    </ul>
  );
}
