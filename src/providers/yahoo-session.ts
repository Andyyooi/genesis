const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((row) => row.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

export type YahooSession = {
  cookie: string;
  crumb: string;
};

export async function createYahooSession(): Promise<YahooSession> {
  const headers = { "User-Agent": UA, Accept: "application/json,text/plain,*/*" };
  let cookie = "";
  try {
    const fc = await fetch("https://fc.yahoo.com", { headers, redirect: "manual" });
    cookie = cookieHeader(fc.headers.getSetCookie?.() ?? []);
  } catch {
    /* crumb fetch may still set cookies */
  }
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const extra = cookieHeader(crumbRes.headers.getSetCookie?.() ?? []);
  if (extra) cookie = cookie ? `${cookie}; ${extra}` : extra;
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 40) {
    throw new Error("Yahoo crumb unavailable — cannot list the Malaysia equity screener");
  }
  return { cookie, crumb };
}

export async function yahooFetch(url: string, session: YahooSession, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", UA);
  headers.set("Accept", "application/json");
  if (session.cookie) headers.set("Cookie", session.cookie);
  return fetch(url, { ...init, headers });
}
