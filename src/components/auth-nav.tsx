import { cookies } from "next/headers";
import { protectionMode, SESSION_COOKIE, verifySession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { RefreshBar } from "@/components/refresh-bar";
import { SnapshotBanner } from "@/components/research/snapshot-banner";
import { loadDataHealth } from "@/refresh/data-health";
import { refreshConfiguration } from "@/refresh/github";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { SiteNav } from "@/components/site-nav";

export async function AuthNav() {
  const cookieStore = await cookies();
  const mode = protectionMode(process.env);
  const authenticated = mode === "enabled" && await verifySession(cookieStore.get(SESSION_COOKIE)?.value, process.env);
  const canReadData = mode === "disabled" || authenticated;
  const health = canReadData ? loadDataHealth() : null;
  return (
    <>
      <header className="site-header border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[88rem] flex-wrap items-center justify-between gap-4 text-sm">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ChartNoAxesCombined className="size-5" aria-hidden="true" /></span><span>Genesis <span className="font-normal text-muted-foreground">Research</span></span></Link>
          <SiteNav />
          {mode === "disabled" ? <span className="status-label status-neutral text-xs">Local preview</span> : null}
          {authenticated ? <form action="/logout" method="post"><Button type="submit" variant="outline">Log out</Button></form> : null}
        </div>
        {canReadData ? <RefreshBar latestPriceDate={health?.asOfDate ?? null} missing={refreshConfiguration().missing} allowed /> : null}
      </header>
      {canReadData ? <SnapshotBanner health={health} /> : null}
    </>
  );
}
