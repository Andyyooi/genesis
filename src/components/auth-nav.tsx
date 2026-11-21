import { cookies } from "next/headers";
import { protectionMode, SESSION_COOKIE, verifySession } from "@/auth/session";
import { Button } from "@/components/ui/button";

export async function AuthNav() {
  const mode = protectionMode(process.env);
  const authenticated = mode === "enabled" && await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env);
  return (
    <header className="border-b px-4 py-3">
      <nav aria-label="Site" className="mx-auto flex max-w-7xl items-center justify-between gap-4 text-sm">
        <span className="font-semibold">Genesis Research</span>
        {mode === "disabled" ? <span className="text-muted-foreground">password protection off (dev)</span> : null}
        {authenticated ? <form action="/logout" method="post"><Button type="submit" variant="outline">Log out</Button></form> : null}
      </nav>
    </header>
  );
}
