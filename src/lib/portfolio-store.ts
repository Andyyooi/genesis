import { emptyRecord, portfolioRecord, type PortfolioRecord } from "@/lib/portfolio";
import { redisCommand, redisCredentials } from "@/lib/redis-rest";

const key = "genesis:portfolio:v1";
const compareAndSet = `
local current = redis.call("GET", KEYS[1]) or ""
if current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`;

export function getPortfolioStore(env: Parameters<typeof redisCredentials>[0] = process.env, request = fetch) {
  const credentials = redisCredentials(env);
  if (!credentials) return null;
  const command = redisCommand(credentials.url, credentials.token, request);
  return {
    async read() {
      const raw = await command("GET", key);
      if (raw === null) return { raw: "", record: emptyRecord };
      if (typeof raw !== "string") throw new Error("Invalid saved portfolio");
      return { raw, record: portfolioRecord.parse(JSON.parse(raw)) };
    },
    async update(expected: string, record: PortfolioRecord) {
      const result = await command("EVAL", compareAndSet, "1", key, expected, JSON.stringify(record));
      if (result !== 0 && result !== 1) throw new Error("Invalid portfolio storage response");
      return result === 1;
    },
  };
}
