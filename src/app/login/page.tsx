import { protectionMode, sanitizeNextPath } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const mode = protectionMode(process.env);
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <Card>
        <CardHeader><CardTitle>Genesis Research</CardTitle></CardHeader>
        <CardContent>
          {mode === "unconfigured" ? <p>The site password isn&apos;t configured. Contact the site administrator.</p> : (
            <form action="/login/submit" method="post" className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Enter the shared password to access research.</p>
              <input type="hidden" name="next" value={sanitizeNextPath(params.next)} />
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={4096} className="h-10 rounded-lg border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring" />
              {params.error ? <p role="alert" className="text-sm text-destructive">Incorrect password. Please try again.</p> : null}
              <Button type="submit">Sign in</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
