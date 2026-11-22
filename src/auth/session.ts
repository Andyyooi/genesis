export const SESSION_COOKIE = "genesis_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export type AuthEnvironment = {
  SITE_PASSWORD?: string;
  SESSION_SECRET?: string;
  NODE_ENV?: string;
  VERCEL?: string;
};

export function isProduction(env: AuthEnvironment): boolean {
  return env.NODE_ENV === "production" || env.VERCEL === "1";
}

export function protectionMode(env: AuthEnvironment): "enabled" | "disabled" | "unconfigured" {
  return env.SITE_PASSWORD ? "enabled" : isProduction(env) ? "unconfigured" : "disabled";
}

export function sanitizeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith("//")) return "/";
    const url = new URL(value, "https://genesis.invalid");
    if (url.origin !== "https://genesis.invalid" || url.pathname.startsWith("//") || url.pathname.startsWith("/login")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

const encoder = new TextEncoder();

export async function constantTimePasswordEqual(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([actual, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  ));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function sessionKey(env: AuthEnvironment) {
  if (!env.SITE_PASSWORD) throw new Error("Site password is not configured");
  const material = JSON.stringify(["genesis-session-v1", env.SESSION_SECRET ?? "", env.SITE_PASSWORD]);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signSession(env: AuthEnvironment, now = Date.now()): Promise<string> {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `v1.${Math.floor(now / 1000) + SESSION_SECONDS}.${nonce}`;
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", await sessionKey(env), encoder.encode(payload)))}`;
}

export async function verifySession(token: string | undefined, env: AuthEnvironment, now = Date.now()): Promise<boolean> {
  if (!token || !env.SITE_PASSWORD || !/^v1\.\d{10,12}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [version, expiry, nonce, signature] = token.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(expiry) <= seconds || Number(expiry) > seconds + SESSION_SECONDS) return false;
  const bytes = new Uint8Array(signature.match(/../g)!.map((byte) => parseInt(byte, 16)));
  return crypto.subtle.verify("HMAC", await sessionKey(env), bytes, encoder.encode(`${version}.${expiry}.${nonce}`));
}

export type GateDecision = "allow" | "unconfigured" | "unauthorized" | "redirect";

export async function gateDecision(path: string, method: string, token: string | undefined, env: AuthEnvironment): Promise<GateDecision> {
  // Only app identity assets are public. Research and all APIs stay behind the password.
  if ((method === "GET" || method === "HEAD") && ["/manifest.webmanifest", "/app-icon-192.png", "/app-icon-512.png", "/apple-touch-icon.png"].includes(path)) return "allow";
  if (path.startsWith("/_next/static/") || path === "/favicon.ico" ||
      (path === "/login" && (method === "GET" || method === "HEAD")) ||
      (path === "/login/submit" && method === "POST")) return "allow";
  const mode = protectionMode(env);
  if (mode === "disabled") return "allow";
  if (mode === "unconfigured") return "unconfigured";
  if (await verifySession(token, env)) return "allow";
  return path === "/api" || path.startsWith("/api/") ? "unauthorized" : "redirect";
}

export function sessionCookieOptions(env: AuthEnvironment) {
  return { httpOnly: true, secure: isProduction(env), sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS };
}
