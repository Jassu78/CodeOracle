import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

const leaseKey = (repoId: string) => `codeoracle:index-lease:${repoId}`;

/** Long enough for large full indexes; refresh + touchIndexLease keep it alive. */
export const INDEX_LEASE_TTL_SEC = 7200;
const REFRESH_MS = 60_000;

/** Process-local renew timers — stopped on release/forceRelease (any path). */
const refreshByRepo = new Map<string, NodeJS.Timeout>();

const RELEASE_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
end
return 0
`;

function stopRefresh(repoId: string): void {
  const t = refreshByRepo.get(repoId);
  if (t) {
    clearInterval(t);
    refreshByRepo.delete(repoId);
  }
}

export type IndexLease = {
  token: string;
  /** Atomically delete the key if we still own it; stop renew timer. */
  release: () => Promise<void>;
};

/**
 * Per-repo single-flight for full/incremental index setup + file jobs.
 * Concurrent workers cannot clear/clone the same repo while another run holds the lease.
 * Renew timer stays alive until release/forceRelease (not stopped after setup).
 */
export async function tryAcquireIndexLease(
  redis: IORedis,
  repoId: string,
): Promise<IndexLease | null> {
  const token = randomUUID();
  const acquired = await redis.set(leaseKey(repoId), token, "EX", INDEX_LEASE_TTL_SEC, "NX");
  if (acquired !== "OK") return null;

  stopRefresh(repoId);
  const refresh = setInterval(() => {
    void redis.eval(RENEW_IF_OWNER, 1, leaseKey(repoId), token, String(INDEX_LEASE_TTL_SEC));
  }, REFRESH_MS);
  refresh.unref();
  refreshByRepo.set(repoId, refresh);

  return {
    token,
    release: async () => {
      stopRefresh(repoId);
      await redis.eval(RELEASE_IF_OWNER, 1, leaseKey(repoId), token);
    },
  };
}

/** Extend TTL while chunk/embed jobs are still running (any worker). */
export async function touchIndexLease(redis: IORedis, repoId: string): Promise<void> {
  const exists = await redis.exists(leaseKey(repoId));
  if (exists) await redis.expire(leaseKey(repoId), INDEX_LEASE_TTL_SEC);
}

/** Recover / finalize / error paths that abandon a run without the original lease handle. */
export async function forceReleaseIndexLease(redis: IORedis, repoId: string): Promise<void> {
  stopRefresh(repoId);
  await redis.del(leaseKey(repoId));
}
