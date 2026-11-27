type RedisEnvironment = Record<string, string | undefined> & {
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export function redisCredentials(env: RedisEnvironment) {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  return null;
}

export function redisCommand(url: string, token: string, request = fetch, label = "Redis") {
  return async (...args: string[]): Promise<unknown> => {
    const response = await request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`${label} request failed`);
    const body = await response.json();
    if (!body || body.error || !Object.hasOwn(body, "result")) throw new Error(`${label} command failed`);
    return body.result;
  };
}
