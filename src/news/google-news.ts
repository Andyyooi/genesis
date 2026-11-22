export type Headline = { title: string; source: string | null; link: string; publishedAt: string | null };
export type StockNews = { ticker: string; name: string; headlines: Headline[]; error: string | null };

const SUFFIXES = /(?<=^|\s)(berhad|bhd\.?|holdings?|group|corporation|corp\.?|international|\(m\)|\(malaysia\))(?=\s|$)/gi;
const WINDOW = "when:30d";
const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { until: number; value: Headline[] }>();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function decode(text: string) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .trim();
}
const tag = (item: string, name: string) => {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : null;
};

/** Names the press uses that differ from the listed company name. */
const ALIASES: Record<string, string[]> = {
  MAYBANK: ["Maybank"], TENAGA: ["Tenaga Nasional", "TNB"], PMETAL: ["Press Metal"], KLK: ["Kuala Lumpur Kepong", "KLK"],
  PCHEM: ["Petronas Chemicals", "PetChem"], MRDIY: ["Mr D.I.Y.", "Mr DIY"], IOICORP: ["IOI Corp"], CDB: ["CelcomDigi"],
};

/** Words used to find a company in headlines, from its listed name (or known press names). */
export function searchTerms(ticker: string, name: string): string[] {
  if (ALIASES[ticker]) return ALIASES[ticker];
  const reit = /real estate investment trust/i.test(name);
  let short = name.replace(/real estate investment trust/i, "").replace(SUFFIXES, " ").replace(/[^\p{L}\p{N}&.' -]/gu, " ").replace(/\s+/g, " ").trim();
  if (reit && short) short = `${short} REIT`;
  else if (/^[A-Z]{1,4}$/.test(short) && /\bcorp/i.test(name)) short = `${short} Corp`;
  return [short.length >= 3 ? short : name.replace(/\s+/g, " ").trim()];
}

export function googleNewsUrl(terms: string[]) {
  const q = `${terms.map(t => `"${t}"`).join(" OR ")} ${WINDOW}`;
  return `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-MY", gl: "MY", ceid: "MY:en" })}`;
}

export function parseRss(xml: string): Headline[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const rawTitle = tag(item, "title");
    const link = tag(item, "link");
    if (!rawTitle || !link || !/^https?:\/\//.test(link)) return [];
    const source = tag(item, "source");
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -source.length - 3) : rawTitle;
    const date = tag(item, "pubDate");
    const time = date ? Date.parse(date) : NaN;
    return [{ title, source, link, publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null }];
  });
}

/** Keeps headlines that name the company, newest first, one per title. */
export function pickHeadlines(items: Headline[], terms: string[] | null, limit: number): Headline[] {
  const patterns = terms?.map(t => new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, /^[A-Z]{2,5}$/.test(t) ? "u" : "iu"));
  const seen = new Set<string>();
  return items
    .filter(h => !patterns || patterns.some(p => p.test(h.title)))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .filter(h => { const key = h.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit);
}

async function fetchFeed(url: string): Promise<Headline[]> {
  const hit = cache.get(url);
  if (hit && hit.until > Date.now()) return hit.value;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (Genesis Research personal feed reader)" } });
  if (!response.ok) throw new Error(`News source returned ${response.status}`);
  const value = parseRss(await response.text());
  cache.set(url, { until: Date.now() + TTL_MS, value });
  return value;
}

export async function stockNews(ticker: string, name: string, limit = 5, fetcher = fetchFeed): Promise<StockNews> {
  const terms = searchTerms(ticker, name);
  try {
    return { ticker, name, headlines: pickHeadlines(await fetcher(googleNewsUrl(terms)), terms, limit), error: null };
  } catch {
    return { ticker, name, headlines: [], error: "News is unavailable right now. Try again later." };
  }
}

export async function marketNews(limit = 8, fetcher = fetchFeed): Promise<Headline[]> {
  try {
    return pickHeadlines(await fetcher(googleNewsUrl(["Bursa Malaysia", "KLCI"]).replace(WINDOW.replace(":", "%3A"), "when%3A3d")), null, limit);
  } catch {
    return [];
  }
}

export async function newsForStocks(stocks: { ticker: string; name: string }[], limit = 5, concurrency = 5, fetcher = fetchFeed) {
  const out: StockNews[] = new Array(stocks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, stocks.length) }, async () => {
    while (next < stocks.length) {
      const i = next++;
      out[i] = await stockNews(stocks[i].ticker, stocks[i].name, limit, fetcher);
    }
  }));
  return out;
}

export function resetNewsCacheForTests() { cache.clear(); }
