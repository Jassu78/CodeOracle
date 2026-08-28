/**
 * Stage 2 integration test — requires live Postgres, Redis, Qdrant, Ollama.
 * Run locally:  pnpm test:integration
 * Skipped in CI unless INTEGRATION_TEST=1 and compose stack is up.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import { JOB_NAMES } from "@codeoracle/contracts";
import { chunks, createDb, registerLocalRepo, repos } from "@codeoracle/db";
import { createQueue, createRedisConnection } from "@codeoracle/queue";
import { runFullIndexSetup, finalizeIndexIfComplete } from "@codeoracle/worker";
import { runChunkFile } from "@codeoracle/worker";
import { runEmbedChunks } from "@codeoracle/worker";

const integrationEnabled = process.env.INTEGRATION_TEST === "1";
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = resolve(projectRoot, "packages/chunker/fixtures");

describe.skipIf(!integrationEnabled)("stage-2 index pipeline", () => {
  it(
    "indexes a local fixture path to ready",
    async () => {
      loadProjectEnv(projectRoot);
      const env = loadEnv();
      const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
      const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
      const redis = createRedisConnection(env.REDIS_URL);
      const queue = createQueue(redis);

      const name = `fixture-${randomUUID().slice(0, 8)}`;
      const { repoId } = await registerLocalRepo(db, {
        name,
        localClonePath: fixtureRoot,
        branch: "main",
      });

      const setup = await runFullIndexSetup({ env, providers, redis, queue, db, repoId });
      expect(setup.filesQueued).toBeGreaterThan(0);

      const jobs = await queue.getJobs(["waiting"], 0, 500);
      for (const job of jobs.filter((j) => j.name === JOB_NAMES.CHUNK_FILE)) {
        await runChunkFile({
          env,
          redis,
          db,
          queue,
          payload: job.data as Parameters<typeof runChunkFile>[0]["payload"],
        });
      }

      const embedJobs = await queue.getJobs(["waiting"], 0, 500);
      for (const job of embedJobs.filter((j) => j.name === JOB_NAMES.EMBED_CHUNKS)) {
        await runEmbedChunks({
          env,
          providers,
          redis,
          db,
          payload: job.data as Parameters<typeof runEmbedChunks>[0]["payload"],
        });
      }

      await finalizeIndexIfComplete({ env, redis, db, repoId });

      const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
      expect(repo?.indexStatus).toBe("ready");

      const chunkRows = await db.select().from(chunks).where(eq(chunks.repoId, repoId));
      expect(chunkRows.length).toBeGreaterThan(0);
      expect(chunkRows.every((c) => c.embeddingStatus === "embedded")).toBe(true);

      await queue.close();
      await redis.quit();
    },
    120_000,
  );
});
