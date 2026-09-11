/**
 * Full-pipeline integration test — index → embed → extract → MCP-tool
 * retrieval, using a scripted local git repo and a fake OpenAI-compatible
 * provider (no network egress, ₹0, deterministic). This is the CI gate the
 * senior review flagged as missing: prior CI only checked that Postgres/
 * Redis/Qdrant containers report healthy, never that the product actually
 * works end to end.
 *
 * Run locally:  pnpm test:integration
 * Requires:     Postgres, Redis, Qdrant reachable at DATABASE_URL/REDIS_URL/
 *               QDRANT_URL (docker compose up). No Ollama/Gemini/GitHub PAT
 *               needed — this test never leaves localhost.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Env } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import {
  chunks,
  createDb,
  decisions,
  registerLocalRepo,
  repos,
} from "@codeoracle/db";
import { createQueue, createRedisConnection } from "@codeoracle/queue";
import { ProviderRegistry } from "@codeoracle/gateway";
import { createQdrantClient, deleteRepoChunkVectors, deleteRepoDecisionVectors } from "@codeoracle/retrieval";
import { explainFile, findDecision, searchCodebase } from "@codeoracle/retrieval";
import {
  runFullIndexSetup,
  runChunkFile,
  runEmbedChunks,
  runExtractDecisions,
} from "@codeoracle/worker";
import { buildSampleGitRepo } from "./fixtures/build-sample-git-repo.js";
import { startFakeProviderServer } from "./fixtures/fake-provider-server.js";

const integrationEnabled = process.env.INTEGRATION_TEST === "1";

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

describe.skipIf(!integrationEnabled)("full pipeline: index → embed → extract → retrieve", () => {
  it(
    "produces citation-backed search/find_decision/explain_file results from a real local repo",
    async () => {
      const fakeProvider = await startFakeProviderServer();
      const sampleRepo = await buildSampleGitRepo();

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
      };

      const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
      const redis = createRedisConnection(env.REDIS_URL);
      const queue = createQueue(redis);
      const qdrant = createQdrantClient(env.QDRANT_URL);
      const gateway = new ProviderRegistry({ config: providers, env: {} });

      const name = `e2e-${randomUUID().slice(0, 8)}`;
      let repoId: string | undefined;

      try {
        ({ repoId } = await registerLocalRepo(db, {
          name,
          localClonePath: sampleRepo.root,
          branch: "main",
        }));

        // 1. Full index setup — crawls local git history, queues chunk_file jobs.
        const setup = await runFullIndexSetup({ env, providers, redis, queue, db, repoId });
        expect(setup.filesQueued).toBeGreaterThan(0);

        // 2. Drain chunk_file → embed_chunks. Single pass per job type — running
        //    a processor function directly (no live BullMQ Worker attached) does
        //    NOT transition the job out of "waiting", so re-polling the same
        //    state would find and reprocess the same jobs forever. Explicitly
        //    remove each job after running it, both to make a single pass
        //    correct and so no orphaned job lingers in the shared Redis queue
        //    for a later test/run to accidentally pick up.
        const belongsToThisRepo = (job: { data: unknown }) =>
          (job.data as { repoId?: string }).repoId === repoId;

        const chunkJobs = (await queue.getJobs(["waiting"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.CHUNK_FILE && belongsToThisRepo(j),
        );
        expect(chunkJobs.length).toBe(setup.filesQueued);
        for (const job of chunkJobs) {
          await runChunkFile({
            env,
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
        expect(embedJobs.length).toBeGreaterThan(0);
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

        const [repoRow] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
        expect(repoRow?.indexStatus).toBe("ready");

        const chunkRows = await db.select().from(chunks).where(eq(chunks.repoId, repoId));
        expect(chunkRows.length).toBeGreaterThan(0);
        expect(chunkRows.every((c) => c.embeddingStatus === "embedded")).toBe(true);

        // 3. Drain extract_decisions (queued automatically by full-index finalize).
        const extractJobs = (await queue.getJobs(["waiting", "delayed"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.EXTRACT_DECISIONS && belongsToThisRepo(j),
        );
        expect(extractJobs.length).toBeGreaterThan(0);
        for (const job of extractJobs) {
          await runExtractDecisions({
            env,
            providers,
            redis,
            db,
            payload: job.data as Parameters<typeof runExtractDecisions>[0]["payload"],
          });
          await job.remove();
        }

        const decisionRows = await db.select().from(decisions).where(eq(decisions.repoId, repoId));
        expect(decisionRows.length).toBeGreaterThan(0);
        for (const d of decisionRows) {
          expect(d.sourceUrl).toMatch(/^https:\/\/github\.com\//);
        }
        expect(fakeProvider.chatCalls.length).toBeGreaterThan(0);

        // 4. Exercise the exact retrieval functions the MCP tools wrap —
        //    the real product surface, not a re-implementation of it.
        const embed = async (texts: string[]) => (await gateway.embed(texts)).vectors;

        const search = await searchCodebase({
          db,
          qdrant,
          embed,
          repoId,
          query: "cache lookup",
          topK: 5,
        });
        expect(search.results.length).toBeGreaterThan(0);
        for (const r of search.results) expect(r.filePath.length).toBeGreaterThan(0);

        const found = await findDecision({
          db,
          qdrant,
          embed,
          repoId,
          topic: "cache",
          // The fake provider's embedding is a crude bag-of-words proxy (word
          // overlap), not real semantic similarity — a single-word query
          // against a multi-sentence decision naturally scores lower than
          // production's default 0.45 / P0-B absolute floor 0.58 would allow.
          // Lower both for this fixture only; production callers use defaults.
          scoreThreshold: 0.3,
          absoluteMinScore: 0.3,
        });
        expect(found.results.length).toBeGreaterThan(0);
        for (const r of found.results) expect(r.sourceUrl).toMatch(/^https:\/\/github\.com\//);

        const explained = await explainFile({ db, repoId, path: "cache/memory-cache.ts" });
        expect(explained.chunkSummaries.length).toBeGreaterThan(0);
      } finally {
        if (repoId) {
          await deleteRepoChunkVectors(qdrant, repoId);
          await deleteRepoDecisionVectors(qdrant, repoId);
          // Cascades chunks / decisions / job_history / api_tokens via FK onDelete.
          await db.delete(repos).where(eq(repos.id, repoId));
        }
        await sampleRepo.cleanup();
        await fakeProvider.stop();
        await queue.close();
        await redis.quit();
      }
    },
    180_000,
  );
});
