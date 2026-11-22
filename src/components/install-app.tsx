"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  if (installed) return null;
  return <details className="install-app w-full max-w-xl rounded-lg border bg-card p-3 text-sm text-foreground">
    <summary className="cursor-pointer font-medium"><Download className="mr-2 inline size-4" aria-hidden="true" />Add Genesis to your phone</summary>
    <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
      <p>Open Genesis from a home-screen icon, without the usual browser bar. Internet access and the normal sign-in are still needed.</p>
      {prompt && <button type="button" className="rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary" onClick={async () => {
        try {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
        } catch { setNotice("Use your browser menu and the steps below to add Genesis."); }
        setPrompt(null);
      }}>Install Genesis</button>}
      {notice && <p role="status">{notice}</p>}
      <p><strong className="text-foreground">iPhone or iPad:</strong> Open in Safari, tap Share, then Add to Home Screen. If asked, turn on Open as Web App, then tap Add.</p>
      <p><strong className="text-foreground">Android:</strong> Open in Chrome, tap the three-dot menu, then Add to Home screen or Install app.</p>
      <p>Save a backup from My holdings before installing or changing browsers. If the app opens with no holdings, restore that backup.</p>
    </div>
  </details>;
}
