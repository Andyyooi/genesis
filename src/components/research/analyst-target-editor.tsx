"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { MAX_IMPORT_BYTES } from "@/analyst-targets/limits";

const field = "w-full min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm";
const button = "rounded-md border px-3 py-1.5 text-sm font-medium text-primary disabled:opacity-50";

export function AnalystTargetEditor({ ticker }: { ticker: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>, csv: boolean) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (csv && (!(file instanceof File) || !file.size || file.size > MAX_IMPORT_BYTES)) {
      setMessage({ text: "Choose a CSV file no larger than 128 KB.", error: true });
      return;
    }

    busy.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/analyst-targets", {
        method: "POST",
        headers: { "Content-Type": csv ? "text/csv" : "application/json" },
        body: csv ? file as File : JSON.stringify({ ...Object.fromEntries(data), ticker }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage({ text: result.error ?? "Couldn't save analyst targets. Try again.", error: true });
        return;
      }
      form.reset();
      setMessage({ text: csv ? `Imported ${result.processed} target row${result.processed === 1 ? "" : "s"}.` : "Analyst target saved.", error: false });
      router.refresh();
    } catch {
      setMessage({ text: "Couldn't save analyst targets. Try again.", error: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary">Add a target or import CSV</summary>
      <div className="mt-2 space-y-3">
        <form className="space-y-2" method="post" onSubmit={(event) => submit(event, false)}>
          <label className="block">Broker <input className={field} name="broker" maxLength={120} required /></label>
          <label className="block">12-month target (RM)
            <input className={field} name="target" type="number" inputMode="decimal" min="0.001" max="99999999.999" step="0.001" required />
          </label>
          <label className="block">Report date <input className={field} name="date" type="date" required /></label>
          <label className="block">Source link <input className={field} name="source_url" type="url" maxLength={2048} placeholder="https://…" required /></label>
          <button className={button} type="submit" disabled={pending}>Save target</button>
        </form>
        <form className="space-y-2 border-t pt-3" method="post" onSubmit={(event) => submit(event, true)}>
          <p className="text-xs text-muted-foreground">A file can include multiple stocks. Use the columns <code className="break-words">ticker, broker, target, date, source_url</code>. Enter prices in RM and dates as YYYY-MM-DD.</p>
          <label className="block">CSV file <input className={field} type="file" name="file" accept=".csv,text/csv" required /></label>
          <button className={button} type="submit" disabled={pending}>Import targets</button>
        </form>
        {pending ? <p role="status">Saving…</p> : null}
        {message ? <p role={message.error ? "alert" : "status"} className={message.error ? "text-destructive" : "text-muted-foreground"}>{message.text}</p> : null}
      </div>
    </details>
  );
}
