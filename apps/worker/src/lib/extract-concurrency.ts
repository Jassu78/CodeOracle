import type IORedis from "ioredis";

const ACTIVE_KEY = "codeoracle:extract:active";
/** Safety TTL so a crashed holder cannot permanently starve extraction. */
const SLOT_TTL_SECONDS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Limits concurrent LLM extraction calls across worker replicas (D3.3 / FR concurrency cap).
 * The counter has a TTL so a crashed worker cannot permanently exhaust the slot.
 */
export async function withExtractConcurrency<T>(
  redis: IORedis,
  maxConcurrent: number,
  fn: () => Promise<T>,
): Promise<T> {
  const limit = Math.max(1, maxConcurrent);
  while (true) {
    const active = await redis.incr(ACTIVE_KEY);
    await redis.expire(ACTIVE_KEY, SLOT_TTL_SECONDS);
    if (active <= limit) break;
    await redis.decr(ACTIVE_KEY);
    await sleep(250);
  }

  try {
    return await fn();
  } finally {
    const left = await redis.decr(ACTIVE_KEY);
    if (left <= 0) await redis.del(ACTIVE_KEY);
    else await redis.expire(ACTIVE_KEY, SLOT_TTL_SECONDS);
  }
}
