import { yahooCalendarDate } from "@/providers/yahoo-calendar";

export const dividendListUrl = "https://klse.i3investor.com/web/entitlement/dividend/latest";

export function dividendAnnouncementUrl(id: string) {
  return new URL(`/web/entitlement/detail/${encodeURIComponent(id)}`, dividendListUrl).href;
}

function announcementDate(value: string | undefined) {
  if (!value || !/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(value)) return null;
  const parsed = yahooCalendarDate(Date.parse(`${value} UTC`) / 1000);
  return parsed?.slice(-2) === value.slice(0, 2) ? parsed : null;
}

export function parseDividendList(html: string) {
  if (!html.includes("Ann. Date") || !html.includes("Ex Date")) throw new Error("Dividend listing was unavailable");
  const entries = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell.trim());
    if (cells.length !== 7) return [];
    const bursaCode = cells[1].match(/href="\/web\/stock\/entitlement\/([0-9A-Z]+)"/i)?.[1];
    const id = cells[6].match(/href="\/web\/entitlement\/detail\/([0-9]+_[0-9]+)"/i)?.[1];
    const exDate = announcementDate(cells[5]);
    const amountText = cells[4].match(/^RM\s+([0-9]+(?:\.[0-9]+)?)$/)?.[1];
    const amount = amountText ? Number(amountText) : null;
    return bursaCode && id && exDate ? [{ bursaCode, id, exDate, amountMyr: amount && Number.isFinite(amount) ? amount : null }] : [];
  });
  const next = html.match(/rel="next"\s+href="\/web\/entitlement\/dividend\/latest\?page=(\d+)"/)?.[1];
  if (!entries.length) throw new Error("No readable entries in dividend listing");
  return { entries, next: next ? Number(next) : null };
}

export function parseDividendPayment(html: string, exDate: string) {
  const dateAfter = (label: string) => announcementDate(html.match(
    new RegExp(`>\\s*${label}\\s*<\\/div>\\s*<div[^>]*>\\s*([^<]+?)\\s*<\\/div>`, "i"),
  )?.[1]);
  const payment = dateAfter("Payment Date");
  return dateAfter("Ex Date") === exDate && payment && payment >= exDate ? payment : null;
}

export type DividendAnnouncementSource = {
  list: (page: number) => Promise<ReturnType<typeof parseDividendList>>;
  payment: (id: string, exDate: string) => Promise<string | null>;
};

export const i3Dividends: DividendAnnouncementSource = {
  async list(page) {
    return parseDividendList(await fetchPage(`${dividendListUrl}?page=${page}`));
  },
  async payment(id, exDate) {
    return parseDividendPayment(await fetchPage(dividendAnnouncementUrl(id)), exDate);
  },
};

async function fetchPage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Dividend announcements returned HTTP ${response.status}`);
  return response.text();
}
