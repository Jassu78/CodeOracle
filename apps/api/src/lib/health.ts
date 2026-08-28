import type { Env } from "@codeoracle/config";
import { createDb, pingDatabase } from "@codeoracle/db";
import { createRedisConnection } from "@codeoracle/queue";

export type HealthCheck = { ok: boolean; error?: string };

export async function checkDeepHealth(env: Env): Promise<{
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
    const redis = createRedisConnection(env.REDIS_URL);
    const pong = await redis.ping();
    await redis.quit();
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
