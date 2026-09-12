import { createHash } from "node:crypto";
import type IORedis from "ioredis";

const KEY_PREFIX = "codeoracle:qcache:v1";
const MAX_VALUE_BYTES = 256 * 1024;

export type SearchCacheParts = {
  repoId: string;
  indexEpoch: number;
  query: string;
  topK: number;
  scoreThreshold: number;
  absoluteMinScore: number;
  rerankEnabled: boolean;
  rerankMaxCandidates: number;
  rerankTimeoutMs: number;
};

export type DecisionCacheParts = {
  repoId: string;
  indexEpoch: number;
  topic: string;
  includeHistory: boolean;
  limit: number;
  scoreThreshold: number;
  relativeFloor: number;
  absoluteMinScore: number;
};

/** Stable SHA-256 over sorted JSON of ranking-affecting opts (excludes repo/epoch). */
export function hashCachePayload(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function searchCacheKey(parts: SearchCacheParts): string {
  const digest = hashCachePayload({
    query: parts.query.trim(),
    topK: parts.topK,
    scoreThreshold: parts.scoreThreshold,
    absoluteMinScore: parts.absoluteMinScore,
    rerankEnabled: parts.rerankEnabled,
    rerankMaxCandidates: parts.rerankMaxCandidates,
    rerankTimeoutMs: parts.rerankTimeoutMs,
  });
  return `${KEY_PREFIX}:search:${parts.repoId}:${parts.indexEpoch}:${digest}`;
}

export function decisionCacheKey(parts: DecisionCacheParts): string {
  const digest = hashCachePayload({
    topic: parts.topic.trim(),
    includeHistory: parts.includeHistory,
    limit: parts.limit,
    scoreThreshold: parts.scoreThreshold,
    relativeFloor: parts.relativeFloor,
    absoluteMinScore: parts.absoluteMinScore,
  });
  return `${KEY_PREFIX}:decision:${parts.repoId}:${parts.indexEpoch}:${digest}`;
}

export function indexEpochFromRepo(repo: {
  lastFullIndexAt: Date | null;
  lastIncrementalAt: Date | null;
}): number {
  const times = [repo.lastFullIndexAt, repo.lastIncrementalAt]
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  return times.length === 0 ? 0 : Math.max(...times);
}

export type QueryCacheGetResult =
  | { ok: true; value: string }
  | { ok: false; reason: "miss" | "error" };

/**
 * Fail-open Redis GET. Never throws to callers — Redis errors → miss/error.
 */
export async function queryCacheGet(
  redis: IORedis,
  key: string,
): Promise<QueryCacheGetResult> {
  try {
    const value = await redis.get(key);
    if (value == null) return { ok: false, reason: "miss" };
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Fail-open Redis SET EX. Skips oversized payloads. Returns false on skip/error.
 */
export async function queryCacheSet(
  redis: IORedis,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) return false;
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  try {
    await redis.set(key, value, "EX", ttl);
    return true;
  } catch {
    return false;
  }
}
