import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import {
  JOB_NAMES,
  type ChunkFileJobPayload,
  type EmbedChunksJobPayload,
  type FullIndexJobPayload,
} from "@codeoracle/contracts";
import { createDb } from "@codeoracle/db";
import { createQueue, createRedisConnection, createWorker } from "@codeoracle/queue";
import { runChunkFile } from "./processors/chunk-file.js";
import { runEmbedChunks } from "./processors/embed-chunks.js";
import { markRepoIndexError, runFullIndexSetup } from "./processors/full-index.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function main() {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));

  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(connection);
  const db = createDb(env.DATABASE_URL);

  const worker = createWorker(connection, async (job) => {
    switch (job.name) {
      case JOB_NAMES.FULL_INDEX: {
        const payload = job.data as FullIndexJobPayload;
        const result = await runFullIndexSetup({ env, providers, redis: connection, queue, db, repoId: payload.repoId });
        console.log(`full_index setup repo=${payload.repoId}`, result);
        return result;
      }
      case JOB_NAMES.CHUNK_FILE: {
        const payload = job.data as ChunkFileJobPayload;
        return runChunkFile({ env, redis: connection, db, queue, payload });
      }
      case JOB_NAMES.EMBED_CHUNKS: {
        const payload = job.data as EmbedChunksJobPayload;
        return runEmbedChunks({ env, providers, redis: connection, db, payload });
      }
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  });

  worker.on("failed", async (job, err) => {
    console.error(`Job ${job?.name} failed:`, err);
    const repoId = (job?.data as { repoId?: string } | undefined)?.repoId;
    // Only a failed full_index setup should mark the whole repo — one bad file must not abort the run.
    if (job?.name === JOB_NAMES.FULL_INDEX && repoId && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await markRepoIndexError(env, repoId, connection, db);
    }
  });

  console.log("CodeOracle worker listening for jobs…");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
