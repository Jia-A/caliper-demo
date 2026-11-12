// Fixed-window rate limits: one counter per window, INCR and EXPIRE in one Upstash transaction
// (/multi-exec), so 6 commands per chat request. Without Upstash env vars, counters are kept in
// memory (one process: local runs only). An Upstash failure throws: the caller refuses the request.
import { LIMITS } from "./limits.js";

const TEN_MIN = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// The three counters this request adds to, each with its limit and when its window ends.
export function windowKeys(ip, now) {
  const w10 = Math.floor(now / TEN_MIN);
  const day = Math.floor(now / DAY);
  return [
    { key: `demo:rl:ip10m:${ip}:${w10}`, limit: LIMITS.perIpPer10Min, ttl: TEN_MIN / 1000, resetAt: (w10 + 1) * TEN_MIN, scope: "ip" },
    { key: `demo:rl:ipday:${ip}:${day}`, limit: LIMITS.perIpPerDay, ttl: DAY / 1000, resetAt: (day + 1) * DAY, scope: "ip" },
    { key: `demo:rl:all:${day}`, limit: LIMITS.allPerDay, ttl: DAY / 1000, resetAt: (day + 1) * DAY, scope: "all" },
  ];
}

const memory = new Map(); // key → { count, resetAt }

async function countUpstash(keys, { url, token }) {
  const commands = keys.flatMap(({ key, ttl }) => [["INCR", key], ["EXPIRE", key, String(ttl)]]);
  const res = await fetch(`${url.replace(/\/+$/, "")}/multi-exec`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(2000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) throw new Error(`rate limit store failed: ${res.status}`);
  return keys.map((_, i) => {
    const count = body[i * 2]?.result;
    if (typeof count !== "number") throw new Error("rate limit store failed: no count");
    return count;
  });
}

function countMemory(keys, now) {
  return keys.map(({ key, resetAt }) => {
    const entry = memory.get(key);
    const next = entry && entry.resetAt > now ? { count: entry.count + 1, resetAt } : { count: 1, resetAt };
    memory.set(key, next);
    return next.count;
  });
}

// { ok: true }, or { ok: false, scope, retryAfter } for the first counter over its limit.
export async function checkLimits(ip, env, now = Date.now()) {
  const keys = windowKeys(ip, now);
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const counts = url && token ? await countUpstash(keys, { url, token }) : countMemory(keys, now);
  const over = keys.find((k, i) => counts[i] > k.limit);
  return over ? { ok: false, scope: over.scope, retryAfter: Math.max(1, Math.ceil((over.resetAt - now) / 1000)) } : { ok: true };
}
