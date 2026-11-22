import { Holdings } from "@/components/holdings";

export default function HoldingsPage() {
  return <main className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
    <header><p className="section-kicker mb-2">YOUR PERSONAL PORTFOLIO</p><h1 className="text-3xl font-semibold">My holdings</h1><p className="mt-2 text-muted-foreground">What you own, what you paid, and what to watch.</p></header>
    <Holdings />
  </main>;
}
