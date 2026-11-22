"use client";

import Link from "next/link";
import { useHeldTickers } from "@/components/holdings-store";
import { Disclosure } from "@/components/research/disclosure";

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
  const held = useHeldTickers();
  rows = [...rows].sort((a, b) => Number(held.has(b.ticker)) - Number(held.has(a.ticker)));
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-xl border border-l-4 border-l-sky-400 bg-card px-4 py-4">
          <p className="text-xs text-muted-foreground">
            {row.triggeredAt.slice(0, 10)} · {row.ticker}
            {held.has(row.ticker) ? " · My holding" : ""}
          </p>
          <p className="font-medium">
            <Link href={row.href} className="underline underline-offset-4">
              {row.title}
            </Link>
          </p>
          <div className="mt-3"><Disclosure title="Why this alert?"><p className="text-sm text-muted-foreground">{row.why}</p><p className="text-xs text-muted-foreground">Rule: {row.ruleId} · {row.triggeredAt.slice(0, 19).replace("T", " ")}</p></Disclosure></div>
        </li>
      ))}
    </ul>
  );
}
