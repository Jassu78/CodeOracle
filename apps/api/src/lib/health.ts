import type { Env } from "@codeoracle/config";
import { createDb, pingDatabase } from "@codeoracle/db";
import type IORedis from "ioredis";

export type HealthCheck = { ok: boolean; error?: string };

/**
 * `redis` is the process's shared connection (see apps/api/src/main.ts) —
 * health checks reuse it instead of opening/closing a throwaway connection
 * on every poll.
 */
export async function checkDeepHealth(
  env: Env,
  redis: IORedis,
): Promise<{
  ok: boolean;
  checks: Record<string, HealthCheck>;
}> {
  const checks: Record<string, HealthCheck> = {};

  try {
    const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
    await pingDatabase(db);
    checks.postgres = { ok: true };
  } catch (err) {
    checks.postgres = { ok: false, error: (err as Error).message };
  }

  try {
    const pong = await redis.ping();
    checks.redis = { ok: pong === "PONG" };
  } catch (err) {
    checks.redis = { ok: false, error: (err as Error).message };
  }

  try {
    const res = await fetch(`${env.QDRANT_URL.replace(/\/$/, "")}/healthz`);
    checks.qdrant = { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    checks.qdrant = { ok: false, error: (err as Error).message };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, checks };
}
