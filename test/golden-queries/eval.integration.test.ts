/**
 * D5.2 golden-query eval — real product path against the D5.1 fixture.
 *
 * Index → embed → extract (fake provider, ₹0, no egress) → score every golden
 * query with structural hit@K / citation rules. PRD NFR-5 gates:
 *   search hit@3 ≥ 80%
 *   find_decision citation correctness = 100%
 *
 * Requires: Postgres, Redis, Qdrant + INTEGRATION_TEST=1 (same as e2e).
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Env } from "@codeoracle/config";
import {
  GoldenQuerySetSchema,
  JOB_NAMES,
  type GoldenQuery,
  type ProvidersConfig,
} from "@codeoracle/contracts";
import { chunks, createDb, decisions, registerLocalRepo, repos } from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
import { createQueue, createRedisConnection } from "@codeoracle/queue";
import {
  createQdrantClient,
  deleteRepoChunkVectors,
  deleteRepoDecisionVectors,
  explainFile,
  findDecision,
  searchCodebase,
} from "@codeoracle/retrieval";
import {
  runChunkFile,
  runEmbedChunks,
  runExtractDecisions,
  runFullIndexSetup,
} from "@codeoracle/worker";
import { buildSampleRepo } from "../fixtures/sample-repo/build.js";
import { startFakeProviderServer } from "../e2e/fixtures/fake-provider-server.js";
import {
  FIND_CITATION_MIN,
  SEARCH_HIT_AT_K_MIN,
  aggregateEvalScores,
  scoreExplainFile,
  scoreFindDecision,
  scoreSearchHit,
  type QueryScore,
} from "./score.js";

const integrationEnabled = process.env.INTEGRATION_TEST === "1";
const here = dirname(fileURLToPath(import.meta.url));

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

/** Bag-of-words fake embeddings score lower than production cosine floors. */
const EVAL_FIND_SCORE_THRESHOLD = 0.25;

describe.skipIf(!integrationEnabled)("golden-query eval (D5.2)", () => {
  it(
    "meets PRD NFR-5 gates on the sample-repo fixture",
    async () => {
      const raw = JSON.parse(await readFile(join(here, "queries.json"), "utf8"));
      const golden = GoldenQuerySetSchema.parse(raw);

      const fakeProvider = await startFakeProviderServer();
      const sampleRepo = await buildSampleRepo();

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
      const embed = async (texts: string[]) => (await gateway.embed(texts)).vectors;

      const name = `golden-eval-${randomUUID().slice(0, 8)}`;
      let repoId: string | undefined;

      try {
        ({ repoId } = await registerLocalRepo(db, {
          name,
          localClonePath: sampleRepo.root,
          branch: "main",
        }));

        const setup = await runFullIndexSetup({ env, providers, redis, queue, db, repoId });
        expect(setup.filesQueued).toBeGreaterThan(0);

        const belongsToThisRepo = (job: { data: unknown }) =>
          (job.data as { repoId?: string }).repoId === repoId;

        for (const job of (await queue.getJobs(["waiting"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.CHUNK_FILE && belongsToThisRepo(j),
        )) {
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

        for (const job of (await queue.getJobs(["waiting"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.EMBED_CHUNKS && belongsToThisRepo(j),
        )) {
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
        expect(chunkRows.every((c) => c.embeddingStatus === "embedded")).toBe(true);

        for (const job of (await queue.getJobs(["waiting", "delayed"], 0, 500)).filter(
          (j) => j.name === JOB_NAMES.EXTRACT_DECISIONS && belongsToThisRepo(j),
        )) {
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

        const queryScores: QueryScore[] = [];
        const findMeta: Array<{ citationOk: boolean; contentOk: boolean }> = [];

        for (const q of golden.queries) {
          const scored = await scoreOneQuery({
            q,
            db,
            qdrant,
            embed,
            repoId,
          });
          queryScores.push(scored.score);
          if (scored.findMeta) findMeta.push(scored.findMeta);
        }

        const agg = aggregateEvalScores(queryScores, findMeta);

        // Readable failure output in CI logs.
        console.log(
          JSON.stringify(
            {
              searchHitAtKRate: agg.searchHitAtKRate,
              findCitationRate: agg.findCitationRate,
              findContentPassed: agg.findContentPassed,
              findTotal: agg.findTotal,
              explainPassed: agg.explainPassed,
              explainTotal: agg.explainTotal,
              failures: queryScores.filter((s) => !s.passed).map((s) => ({ id: s.id, detail: s.detail })),
            },
            null,
            2,
          ),
        );

        expect(agg.searchHitAtKRate).toBeGreaterThanOrEqual(SEARCH_HIT_AT_K_MIN);
        expect(agg.findCitationRate).toBeGreaterThanOrEqual(FIND_CITATION_MIN);
        expect(agg.passed).toBe(true);
      } finally {
        if (repoId) {
          await deleteRepoChunkVectors(qdrant, repoId);
          await deleteRepoDecisionVectors(qdrant, repoId);
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

async function scoreOneQuery(opts: {
  q: GoldenQuery;
  db: ReturnType<typeof createDb>;
  qdrant: ReturnType<typeof createQdrantClient>;
  embed: (texts: string[]) => Promise<number[][]>;
  repoId: string;
}): Promise<{
  score: QueryScore;
  findMeta?: { citationOk: boolean; contentOk: boolean };
}> {
  const { q, db, qdrant, embed, repoId } = opts;

  if (q.tool === "search_codebase") {
    const out = await searchCodebase({
      db,
      qdrant,
      embed,
      repoId,
      query: q.query,
      topK: Math.max(q.expect.hitAt ?? 3, 5),
      // Fake bag-of-words embeddings — slightly looser than production default.
      scoreThreshold: 0.15,
    });
    const r = scoreSearchHit(out.results, q.expect);
    return { score: { id: q.id, tool: q.tool, passed: r.passed, detail: r.detail } };
  }

  if (q.tool === "find_decision") {
    const out = await findDecision({
      db,
      qdrant,
      embed,
      repoId,
      topic: q.query,
      scoreThreshold: EVAL_FIND_SCORE_THRESHOLD,
    });
    const r = scoreFindDecision(out.results, q.expect);
    return {
      score: { id: q.id, tool: q.tool, passed: r.passed, detail: r.detail },
      findMeta: { citationOk: r.citationOk, contentOk: r.contentOk },
    };
  }

  const out = await explainFile({ db, repoId, path: q.expect.path });
  const r = scoreExplainFile(out, q.expect);
  return { score: { id: q.id, tool: q.tool, passed: r.passed, detail: r.detail } };
}
