/**
 * Stage 2 index-only integration test — crawl → chunk → embed → ready.
 * Uses the fake OpenAI-compatible provider (no Ollama / providers.yaml),
 * same CI-safe stack as full-pipeline.integration.test.ts.
 *
 * Run:  pnpm test:integration
 * Requires: Postgres, Redis, Qdrant (docker compose up).
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Env } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import { chunks, createDb, registerLocalRepo, repos } from "@codeoracle/db";
import { createQueue, createRedisConnection } from "@codeoracle/queue";
import { createQdrantClient, deleteRepoChunkVectors } from "@codeoracle/retrieval";
import { runFullIndexSetup, finalizeIndexIfComplete } from "@codeoracle/worker";
import { runChunkFile } from "@codeoracle/worker";
import { runEmbedChunks } from "@codeoracle/worker";
import { startFakeProviderServer } from "./fixtures/fake-provider-server.js";

const integrationEnabled = process.env.INTEGRATION_TEST === "1";
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = resolve(projectRoot, "packages/chunker/fixtures");

const env = {
  NODE_ENV: "test" as const,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://codeoracle:change-me-in-dev@localhost:5432/codeoracle",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  QDRANT_URL: process.env.QDRANT_URL ?? "http://localhost:6333",
  CODEORACLE_CLONE_DIR: "./data/clones",
  PROVIDERS_CONFIG_PATH: "./providers.yaml",
  WORKER_CONCURRENCY: 6,
  DB_POOL_MAX: 5,
  EMBED_BATCH_SIZE: 32,
  JOB_HISTORY_RETENTION_DAYS: 30,
  EXTRACT_CONCURRENCY: 2,
  EXTRACT_MIN_CONFIDENCE: 0.5,
  EXTRACT_QUEUE_LIMIT: 0,
  CLONE_HISTORY_DEPTH: 200,
  CLONE_MAX_REPOS: 50,
  INDEX_RECOVER_ON_STARTUP: true,
} as unknown as Env;

describe.skipIf(!integrationEnabled)("stage-2 index pipeline", () => {
  it(
    "indexes a local fixture path to ready",
    async () => {
      const fakeProvider = await startFakeProviderServer();
      const providers: ProvidersConfig = {
        chat: [
          {
            id: "fake-chat",
            kind: "chat",
            baseUrl: fakeProvider.baseUrl,
            apiKeyEnv: null,
            model: "fake-model",
            priority: 1,
            enabled: true,
          },
        ],
        embeddings: [
          {
            id: "fake-embed",
            kind: "embeddings",
            baseUrl: fakeProvider.baseUrl,
            apiKeyEnv: null,
            model: "fake-embed-model",
            priority: 1,
            enabled: true,
          },
        ],
        rerank: [],
      };

      const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
      const redis = createRedisConnection(env.REDIS_URL);
      const queue = createQueue(redis);
      const qdrant = createQdrantClient(env.QDRANT_URL);

      const name = `fixture-${randomUUID().slice(0, 8)}`;
      let repoId: string | undefined;

      try {
        ({ repoId } = await registerLocalRepo(db, {
          name,
          localClonePath: fixtureRoot,
          branch: "main",
        }));

        const setup = await runFullIndexSetup({ env, providers, redis, queue, db, repoId });
        expect(setup.filesQueued).toBeGreaterThan(0);

        // Single pass + explicit removal — see full-pipeline.integration.test.ts
        // for why: invoking a processor function directly never transitions
        // the BullMQ job out of "waiting", so a leftover job here would sit
        // in the shared queue and get picked up by an unrelated later test run.
        const belongsToThisRepo = (job: { data: unknown }) =>
          (job.data as { repoId?: string }).repoId === repoId;

        const chunkJobs = (await queue.getJobs(["waiting"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.CHUNK_FILE && belongsToThisRepo(j),
        );
        for (const job of chunkJobs) {
          await runChunkFile({
            env,
            providers,
            redis,
            db,
            queue,
            payload: job.data as Parameters<typeof runChunkFile>[0]["payload"],
          });
          await job.remove();
        }

        const embedJobs = (await queue.getJobs(["waiting"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.EMBED_CHUNKS && belongsToThisRepo(j),
        );
        for (const job of embedJobs) {
          await runEmbedChunks({
            env,
            providers,
            redis,
            db,
            queue,
            payload: job.data as Parameters<typeof runEmbedChunks>[0]["payload"],
          });
          await job.remove();
        }

        await finalizeIndexIfComplete({ env, redis, db, repoId });

        const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
        expect(repo?.indexStatus).toBe("ready");

        const chunkRows = await db.select().from(chunks).where(eq(chunks.repoId, repoId));
        expect(chunkRows.length).toBeGreaterThan(0);
        expect(chunkRows.every((c) => c.embeddingStatus === "embedded")).toBe(true);
      } finally {
        if (repoId) {
          await deleteRepoChunkVectors(qdrant, repoId);
          await db.delete(repos).where(eq(repos.id, repoId));
        }
        await fakeProvider.stop();
        await queue.close();
        await redis.quit();
      }
    },
    120_000,
  );
});
