import { describe, expect, it } from "vitest";
import { googleNewsUrl, newsForStocks, parseRss, pickHeadlines, searchTerms } from "../src/news/google-news";

const rss = `<rss><channel><title>x</title>
<item><title>Maybank Q3 profit falls 5% - The Star</title><link>https://news.google.com/a</link><pubDate>Fri, 20 Nov 2026 02:00:00 GMT</pubDate><source url="https://thestar.com.my">The Star</source></item>
<item><title>Maybank Q3 profit falls 5% - The Edge</title><link>https://news.google.com/b</link><pubDate>Thu, 19 Nov 2026 02:00:00 GMT</pubDate><source url="https://theedge">The Edge</source></item>
<item><title>Bursa ends lower &amp; CIMB slips - NST</title><link>https://news.google.com/c</link><pubDate>Sat, 21 Nov 2026 02:00:00 GMT</pubDate><source url="https://nst">NST</source></item>
<item><title><![CDATA[Miscellaneous update]]></title><link>https://news.google.com/d</link></item>
</channel></rss>`;

describe("news headlines", () => {
  it("builds company search words from the stored name", () => {
    expect(searchTerms("MAYBANK", "Malayan Banking Berhad")).toEqual(["Maybank"]);
    expect(searchTerms("GAMUDA", "Gamuda Berhad")).toEqual(["Gamuda"]);
    expect(searchTerms("XYZ", "XYZ Corporation Berhad")).toEqual(["XYZ Corp"]);
    expect(searchTerms("TM", "Telekom Malaysia Berhad")).toEqual(["Telekom Malaysia"]);
    expect(searchTerms("MRDIY", "Mr D.I.Y. Group (M) Berhad")).toEqual(["Mr D.I.Y.", "Mr DIY"]);
    expect(searchTerms("SUNREIT", "Sunway Real Estate Investment Trust")).toEqual(["Sunway REIT"]);
    expect(searchTerms("MHC", "MHC Plantations Bhd.")).toEqual(["MHC Plantations"]);
    expect(googleNewsUrl(["CIMB"])).toContain("gl=MY");
  });
  it("parses dated headlines and strips the source suffix", () => {
    const items = parseRss(rss);
    expect(items[0]).toEqual({ title: "Maybank Q3 profit falls 5%", source: "The Star", link: "https://news.google.com/a", publishedAt: "2026-11-20T02:00:00.000Z" });
    expect(items[2].title).toBe("Bursa ends lower & CIMB slips");
    expect(items[3]).toMatchObject({ title: "Miscellaneous update", source: null, publishedAt: null });
  });
  it("keeps headlines naming the company, newest first, without repeats", () => {
    const items = parseRss(rss);
    expect(pickHeadlines(items, ["Maybank"], 5).map(h => h.link)).toEqual(["https://news.google.com/a"]);
    expect(pickHeadlines(items, ["MISC"], 5)).toEqual([]);
    expect(pickHeadlines(items, [searchTerms("CIMB", "CIMB GROUP HOLDINGS BERHAD")[0]], 5)).toHaveLength(1);
    expect(pickHeadlines([{ title: "Maxis adds 5G users", source: null, link: "https://x.test/m", publishedAt: null }], [searchTerms("MAXIS", "MAXIS BERHAD")[0]], 5)).toHaveLength(1);
    expect(pickHeadlines(items, null, 2).map(h => h.link)).toEqual(["https://news.google.com/c", "https://news.google.com/a"]);
  });
  it("reports an unavailable source without failing other stocks", async () => {
    const fetcher = async (url: string) => { if (url.includes("CIMB")) throw new Error("down"); return parseRss(rss); };
    const out = await newsForStocks([{ ticker: "MAYBANK", name: "Malayan Banking Berhad" }, { ticker: "CIMB", name: "CIMB Group Holdings Berhad" }], 5, 2, fetcher);
    expect(out[0].headlines).toHaveLength(1);
    expect(out[1]).toMatchObject({ ticker: "CIMB", headlines: [], error: expect.stringContaining("unavailable") });
  });
  it("recognizes Penang water headlines without matching bare PBA", () => {
    const items = ["PBAPP reports higher costs", "PBA Holdings reports results", "PBA basketball results"].map((title, i) => ({
      title, source: null, link: `https://x.test/${i}`, publishedAt: null,
    }));
    expect(pickHeadlines(items, searchTerms("PBA", "PBA Holdings Bhd"), 5).map(h => h.title)).toEqual(items.slice(0, 2).map(h => h.title));
  });
});
