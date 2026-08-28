import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import {
  JOB_NAMES,
  type ChunkFileJobPayload,
  type EmbedChunksJobPayload,
  type ExtractDecisionsJobPayload,
  type FullIndexJobPayload,
} from "@codeoracle/contracts";
import { createDb, pruneJobHistory } from "@codeoracle/db";
import { createQueue, createRedisConnection, createWorker } from "@codeoracle/queue";
import { createLogger } from "@codeoracle/observability";
import { registerGracefulShutdown } from "./lib/graceful-shutdown.js";
import { handleIndexJobFailure } from "./lib/handle-index-job-failure.js";
import { recoverAllStaleIndexes } from "./lib/recover-stale-index.js";
import { logWorkerStartup } from "./lib/worker-banner.js";
import { acquireWorkerLeaderLock } from "./lib/worker-leader-lock.js";
import { runChunkFile } from "./processors/chunk-file.js";
import { runEmbedChunks } from "./processors/embed-chunks.js";
import { runExtractDecisions } from "./processors/extract-decisions.js";
import { markRepoIndexError, runFullIndexSetup } from "./processors/full-index.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const log = createLogger("worker");

async function main() {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));

  const connection = createRedisConnection(env.REDIS_URL);
  const leaderLock = await acquireWorkerLeaderLock(connection);
  const queue = createQueue(connection);
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  logWorkerStartup({ cwd: projectRoot, concurrency: env.WORKER_CONCURRENCY });

  const pruned = await pruneJobHistory(db, env.JOB_HISTORY_RETENTION_DAYS);
  if (pruned > 0) log.info("Pruned old job_history rows", { count: pruned });

  if (env.INDEX_RECOVER_ON_STARTUP) {
    const recovered = await recoverAllStaleIndexes({ env, redis: connection, db, queue });
    for (const result of recovered) {
      if (result.action !== "unchanged") {
        log.warn("Recovered stale index run", {
          repoId: result.repoId,
          action: result.action,
          detail: result.detail,
        });
      }
    }
  }

  const worker = createWorker(
    connection,
    async (job) => {
      switch (job.name) {
        case JOB_NAMES.FULL_INDEX: {
          const payload = job.data as FullIndexJobPayload;
          const result = await runFullIndexSetup({
            env,
            providers,
            redis: connection,
            queue,
            db,
            repoId: payload.repoId,
          });
          log.info("full_index setup complete", { repoId: payload.repoId, ...result });
          return result;
        }
        case JOB_NAMES.CHUNK_FILE: {
          const payload = job.data as ChunkFileJobPayload;
          return runChunkFile({ env, redis: connection, db, queue, payload });
        }
        case JOB_NAMES.EMBED_CHUNKS: {
          const payload = job.data as EmbedChunksJobPayload;
          return runEmbedChunks({ env, providers, redis: connection, db, queue, payload });
        }
        case JOB_NAMES.EXTRACT_DECISIONS: {
          const payload = job.data as ExtractDecisionsJobPayload;
          const result = await runExtractDecisions({
            env,
            providers,
            redis: connection,
            db,
            payload,
          });
          log.info("extract_decisions complete", { repoId: payload.repoId, ...result });
          return result;
        }
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    env.WORKER_CONCURRENCY,
  );

  worker.on("failed", async (job, err) => {
    log.error("Job failed", { jobName: job?.name, err: (err as Error).message });
    await handleIndexJobFailure({ env, redis: connection, db, queue, job, err: err as Error });

    const repoId = (job?.data as { repoId?: string } | undefined)?.repoId;
    if (job?.name === JOB_NAMES.FULL_INDEX && repoId && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await markRepoIndexError(env, repoId, connection, db);
    }
  });

  log.info("Worker listening for jobs");
  await registerGracefulShutdown({
    worker,
    redis: connection,
    onShutdown: leaderLock.release,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
