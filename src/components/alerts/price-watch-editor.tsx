"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatSharePrice } from "@/lib/format-myr";
import type { PriceWatch } from "@/price-watches/watch";

const field = "min-w-0 w-full rounded border bg-background p-2 text-base";
const button = "rounded border px-3 py-2 text-sm font-medium disabled:opacity-50";

export function PriceWatchEditor({ ticker, initialWatch }: { ticker: string; initialWatch: PriceWatch | null }) {
  const router = useRouter();
  const [watch, setWatch] = useState(initialWatch);
  const [kind, setKind] = useState<PriceWatch["kind"]>(initialWatch?.kind ?? "target");
  const [target, setTarget] = useState(initialWatch?.kind === "target" ? String(initialWatch.target) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const unchanged = watch?.kind === kind && (watch.kind === "fair-range" || watch.target === Number(target));

  async function update(remove = false) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/price-watches/${encodeURIComponent(ticker)}`, remove ? { method: "DELETE" } : {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "target" ? { kind, target: Number(target) } : { kind }),
      });
      const result = await response.json() as { watch: PriceWatch | null; error?: string };
      if (!response.ok) {
        setError(response.status === 401 ? "Sign in again to change your watch." : result.error ?? "Couldn’t change the price watch.");
        return;
      }
      setWatch(result.watch);
      setMessage(remove ? "Watch removed." : "Watch saved.");
      router.refresh();
    } catch {
      setError("Couldn’t change the price watch. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {watch?.kind === "target" ? `Watching for a close at or below ${formatSharePrice(watch.target)}.`
          : watch?.kind === "fair-range" ? "Watching for a close that moves into the Genesis fair range."
            : "Get an alert when a saved closing price meets your rule."}{" "}
        <Link href="/alerts" className="underline underline-offset-4">See Alerts</Link>
      </p>
      <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void update(); }}>
        <fieldset className="flex flex-col gap-3" disabled={busy}>
          <label className="flex flex-col gap-1 text-sm">
            Alert when
            <select className={field} value={kind} onChange={(event) => setKind(event.target.value as PriceWatch["kind"])}>
              <option value="target">Close is at or below my target</option>
              <option value="fair-range">Close enters the Genesis fair range</option>
            </select>
          </label>
          {kind === "target" && (
            <label className="flex flex-col gap-1 text-sm">
              Target price (RM per share)
              <input className={field} type="number" min="0.001" step="0.001" required value={target} onChange={(event) => setTarget(event.target.value)} placeholder="e.g. 2.50" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={`${button} bg-primary text-primary-foreground`} type="submit" disabled={unchanged}>
              {watch ? "Save changes" : "Save watch"}
            </button>
            {watch && <button className={button} type="button" onClick={() => void update(true)}>Remove watch</button>}
          </div>
        </fieldset>
      </form>
      {message && <p className="mt-2 text-sm" role="status">{message}</p>}
      {error && <p className="mt-2 text-sm" role="alert">{error}</p>}
    </>
  );
}
