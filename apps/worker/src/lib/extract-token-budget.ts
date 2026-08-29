import type IORedis from "ioredis";

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function extractTokenBudgetKey(repoId: string, day = utcDayKey()): string {
  return `codeoracle:extract:tokens:${repoId}:${day}`;
}

/**
 * G3.19 — per-repo daily LLM token budget for extract.
 * budget=0 disables the check.
 */
export async function checkExtractTokenBudget(
  redis: IORedis,
  repoId: string,
  budget: number,
): Promise<{ ok: true; used: number } | { ok: false; used: number; budget: number }> {
  if (budget <= 0) return { ok: true, used: 0 };
  const usedRaw = await redis.get(extractTokenBudgetKey(repoId));
  const used = Number.parseInt(usedRaw ?? "0", 10) || 0;
  if (used >= budget) return { ok: false, used, budget };
  return { ok: true, used };
}

export async function recordExtractTokens(
  redis: IORedis,
  repoId: string,
  tokens: number,
): Promise<number> {
  if (tokens <= 0) return 0;
  const key = extractTokenBudgetKey(repoId);
  const used = await redis.incrby(key, tokens);
  // Expire shortly after day boundary so keys don't pile up forever.
  if (used === tokens) await redis.expire(key, 48 * 60 * 60);
  return used;
}
