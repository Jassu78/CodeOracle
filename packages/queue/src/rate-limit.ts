import type { IncomingMessage } from "node:http";
import type IORedis from "ioredis";

/**
 * Redis-backed fixed-window rate limiter — shared across API / MCP HTTP
 * replicas and bounded by TTL (unlike an in-memory Map).
 */
export async function checkRateLimit(
  redis: IORedis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const redisKey = `codeoracle:ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, Math.max(1, Math.ceil(windowMs / 1000)));
  }
  return count <= limit;
}

export function clientKeyFromRequest(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}
