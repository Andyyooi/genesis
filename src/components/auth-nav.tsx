import { cookies } from "next/headers";
import { protectionMode, SESSION_COOKIE, verifySession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { RefreshBar } from "@/components/refresh-bar";
import { deployedSnapshotState } from "@/refresh/deployed-snapshot";
import { refreshConfiguration } from "@/refresh/github";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { SiteNav } from "@/components/site-nav";

export async function AuthNav() {
  const mode = protectionMode(process.env);
  const authenticated = mode === "enabled" && await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env);
  return (
    <header className="site-header border-b px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-[88rem] flex-wrap items-center justify-between gap-4 text-sm">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-tight"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><ChartNoAxesCombined className="size-5" aria-hidden="true" /></span><span>Genesis <span className="font-normal text-muted-foreground">Research</span></span></Link>
        <SiteNav />
        {mode === "disabled" ? <span className="status-label status-neutral text-xs">Local preview</span> : null}
        {authenticated ? <form action="/logout" method="post"><Button type="submit" variant="outline">Log out</Button></form> : null}
      </div>
      <RefreshBar latestPriceDate={deployedSnapshotState().latestPriceDate} missing={refreshConfiguration().missing} allowed={mode === "disabled" || authenticated} />
    </header>
  );
}
