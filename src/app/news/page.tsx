import { NewsBoard } from "@/components/news-headlines";

export default function NewsPage() {
  return <main className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
    <header><p className="section-kicker mb-2">HEADLINES</p><h1 className="text-3xl font-semibold">News</h1><p className="mt-2 text-muted-foreground">Recent headlines for the stocks you hold and watch, with dates and links to the full articles.</p></header>
    <NewsBoard />
  </main>;
}
