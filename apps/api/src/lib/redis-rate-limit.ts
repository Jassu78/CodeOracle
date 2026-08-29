import type IORedis from "ioredis";

/**
 * Redis-backed fixed-window rate limiter — shared across API replicas and
 * bounded by TTL (unlike an in-memory `Map`, which grows by one entry per
 * unique client forever and is meaningless once there is more than one
 * API process).
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

export function clientKey(req: import("node:http").IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}
