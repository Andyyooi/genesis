"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

const KINDS = [
  { kind: "quick", label: "Quick report", ext: "Markdown" },
  { kind: "full", label: "Full report", ext: "Markdown" },
  { kind: "json", label: "Raw JSON", ext: "JSON" },
  { kind: "csv", label: "Tables CSV", ext: "CSV" },
] as const;

export function ExportActions({ ticker }: { ticker: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(kind: string) {
    setError(null);
    try {
      const response = await fetch(`/export/${ticker}/${kind}`);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const text = await response.text();
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border px-4 py-3">
      <p className="text-sm font-medium">Export for ChatGPT</p>
      <p className="text-sm text-muted-foreground">
        Download or copy Quick Markdown, Full Markdown, Raw JSON (ScoreResult payload), or CSV
        tables. Missing numbers stay unavailable. Not a buy or sell note.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {KINDS.map((item) => (
          <div key={item.kind} className="flex flex-wrap gap-1">
            <a
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href={`/export/${ticker}/${item.kind}`}
              download
            >
              Download {item.label}
            </a>
            <Button variant="ghost" size="sm" onClick={() => copy(item.kind)} type="button">
              {copied === item.kind ? "Copied" : `Copy ${item.ext}`}
            </Button>
          </div>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
