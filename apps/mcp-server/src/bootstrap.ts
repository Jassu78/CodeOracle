/**
 * Shared MCP runtime wiring — loads env/db/gateway and builds tool runners.
 * Transports (stdio / HTTP) call this; they must not contain tool logic.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  loadEnv,
  loadProjectEnv,
  loadProvidersConfig,
  type Env,
  assertProductionSafety,
} from "@codeoracle/config";
import {
  FindDecisionOutputSchema,
  SearchCodebaseOutputSchema,
} from "@codeoracle/contracts";
import {
  DECISION_ABSOLUTE_SCORE_FLOOR,
  DECISION_RELATIVE_SCORE_FLOOR,
  SEARCH_ABSOLUTE_SCORE_FLOOR,
} from "@codeoracle/core-domain";
import { createDb, repos, type Database } from "@codeoracle/db";
import { ProviderRegistry, createSearchRerankFn } from "@codeoracle/gateway";
import { logQueryLatency } from "@codeoracle/observability";
import {
  createRedisConnection,
  decisionCacheKey,
  indexEpochFromRepo,
  queryCacheGet,
  queryCacheSet,
  searchCacheKey,
} from "@codeoracle/queue";
import {
  createQdrantClient,
  explainFile,
  findDecision,
  searchCodebase,
} from "@codeoracle/retrieval";
import { createCodeOracleMcpServer } from "./create-server.js";
import { mcpLog } from "./log.js";
import type { ExplainFileRunner } from "./tools/explain-file.js";
import type { FindDecisionRunner } from "./tools/find-decision.js";
import type { SearchCodebaseRunner } from "./tools/search-codebase.js";

export const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export type McpRuntime = {
  env: Env;
  db: Database;
  repoId: string;
  findDecision: FindDecisionRunner;
  searchCodebase: SearchCodebaseRunner;
  explainFile: ExplainFileRunner;
  createServer: () => ReturnType<typeof createCodeOracleMcpServer>;
};

const SEARCH_DENSE_THRESHOLD_DEFAULT = 0.35;
const DECISION_DENSE_THRESHOLD_DEFAULT = 0.45;
const FIND_DECISION_LIMIT_DEFAULT = 3;

export async function bootstrapMcpRuntime(): Promise<McpRuntime> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  assertProductionSafety(env);

  if (!env.CODEORACLE_REPO_ID) {
    throw new Error(
      "CODEORACLE_REPO_ID is required for mcp-server (UUID from `pnpm cli repo status`). See .env.example.",
    );
  }
  const repoId = env.CODEORACLE_REPO_ID;

  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const qdrant = createQdrantClient(env.QDRANT_URL);
  const redis = createRedisConnection(env.REDIS_URL);
  const gateway = new ProviderRegistry({
    config: providers,
    env: process.env,
    onUsage: (event) => {
      if (!event.success) {
        mcpLog("warn", "provider call failed", {
          providerId: event.providerId,
          model: event.model,
          kind: event.kind,
          error: event.error,
        });
      }
    },
  });

  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  if (!repo) {
    throw new Error(`CODEORACLE_REPO_ID=${repoId} not found in Postgres — register/index the repo first.`);
  }
  if (repo.indexStatus !== "ready") {
    mcpLog("warn", "Repo index_status is not ready — tools may return empty results", {
      repoId,
      indexStatus: repo.indexStatus,
    });
  }

  await qdrant.getCollections();

  const embed = async (texts: string[]) => (await gateway.embed(texts)).vectors;

  const rerankEnabled = env.SEARCH_RERANK_ENABLED;
  const rerank = createSearchRerankFn(gateway, providers, {
    enabled: rerankEnabled,
    timeoutMs: env.SEARCH_RERANK_TIMEOUT_MS,
  });

  const cacheEnabled = env.QUERY_CACHE_ENABLED;
  const cacheTtl = env.QUERY_CACHE_TTL_SECONDS;

  async function currentIndexEpoch(): Promise<number> {
    const [row] = await db
      .select({
        lastFullIndexAt: repos.lastFullIndexAt,
        lastIncrementalAt: repos.lastIncrementalAt,
      })
      .from(repos)
      .where(eq(repos.id, repoId))
      .limit(1);
    return indexEpochFromRepo(row ?? { lastFullIndexAt: null, lastIncrementalAt: null });
  }

  const runners = {
    findDecision: (async ({ topic, includeHistory }) => {
      const started = Date.now();
      const includeHistoryNorm = includeHistory ?? false;
      const limit = FIND_DECISION_LIMIT_DEFAULT;
      const scoreThreshold = DECISION_DENSE_THRESHOLD_DEFAULT;
      const relativeFloor = DECISION_RELATIVE_SCORE_FLOOR;
      const absoluteMinScore = DECISION_ABSOLUTE_SCORE_FLOOR;
      const indexEpoch = await currentIndexEpoch();
      const key = decisionCacheKey({
        repoId,
        indexEpoch,
        topic,
        includeHistory: includeHistoryNorm,
        limit,
        scoreThreshold,
        relativeFloor,
        absoluteMinScore,
      });

      let cacheState: "hit" | "miss" | "bypass" | "error" = cacheEnabled ? "miss" : "bypass";

      if (cacheEnabled) {
        const cached = await queryCacheGet(redis, key);
        if (cached.ok) {
          try {
            const parsed = FindDecisionOutputSchema.parse(JSON.parse(cached.value));
            const latencyMs = Date.now() - started;
            logQueryLatency({
              tool: "find_decision",
              repoId,
              cache: "hit",
              latencyMs,
              embedMs: null,
              latencyEmbedExcludedMs: latencyMs,
              resultCount: parsed.results.length,
            });
            return parsed;
          } catch {
            cacheState = "miss";
          }
        } else if (cached.reason === "error") {
          cacheState = "error";
        }
      }

      let embedMs = 0;
      const timedEmbed = async (texts: string[]) => {
        const t0 = Date.now();
        try {
          return await embed(texts);
        } finally {
          embedMs += Date.now() - t0;
        }
      };

      const out = await findDecision({
        db,
        qdrant,
        embed: timedEmbed,
        repoId,
        topic,
        includeHistory: includeHistoryNorm,
      });

      if (cacheEnabled && cacheState !== "error") {
        await queryCacheSet(redis, key, JSON.stringify(out), cacheTtl);
      }

      const latencyMs = Date.now() - started;
      logQueryLatency({
        tool: "find_decision",
        repoId,
        cache: cacheState,
        latencyMs,
        embedMs,
        latencyEmbedExcludedMs: Math.max(0, latencyMs - embedMs),
        resultCount: out.results.length,
      });
      return out;
    }) satisfies FindDecisionRunner,

    searchCodebase: (async ({ query, topK }) => {
      const started = Date.now();
      const topKNorm = topK ?? 10;
      const scoreThreshold = SEARCH_DENSE_THRESHOLD_DEFAULT;
      const absoluteMinScore = SEARCH_ABSOLUTE_SCORE_FLOOR;
      const indexEpoch = await currentIndexEpoch();
      const key = searchCacheKey({
        repoId,
        indexEpoch,
        query,
        topK: topKNorm,
        scoreThreshold,
        absoluteMinScore,
        rerankEnabled,
        rerankMaxCandidates: env.SEARCH_RERANK_MAX_CANDIDATES,
        rerankTimeoutMs: env.SEARCH_RERANK_TIMEOUT_MS,
      });

      let cacheState: "hit" | "miss" | "bypass" | "error" = cacheEnabled ? "miss" : "bypass";

      if (cacheEnabled) {
        const cached = await queryCacheGet(redis, key);
        if (cached.ok) {
          try {
            const parsed = SearchCodebaseOutputSchema.parse(JSON.parse(cached.value));
            const latencyMs = Date.now() - started;
            logQueryLatency({
              tool: "search_codebase",
              repoId,
              cache: "hit",
              latencyMs,
              embedMs: null,
              latencyEmbedExcludedMs: latencyMs,
              resultCount: parsed.results.length,
            });
            return parsed;
          } catch {
            cacheState = "miss";
          }
        } else if (cached.reason === "error") {
          cacheState = "error";
        }
      }

      let embedMs = 0;
      const timedEmbed = async (texts: string[]) => {
        const t0 = Date.now();
        try {
          return await embed(texts);
        } finally {
          embedMs += Date.now() - t0;
        }
      };

      const out = await searchCodebase({
        db,
        qdrant,
        embed: timedEmbed,
        repoId,
        query,
        topK: topKNorm,
        rerankEnabled,
        rerank,
        rerankMaxCandidates: env.SEARCH_RERANK_MAX_CANDIDATES,
        rerankTimeoutMs: env.SEARCH_RERANK_TIMEOUT_MS,
      });

      if (cacheEnabled && cacheState !== "error") {
        await queryCacheSet(redis, key, JSON.stringify(out), cacheTtl);
      }

      const latencyMs = Date.now() - started;
      logQueryLatency({
        tool: "search_codebase",
        repoId,
        cache: cacheState,
        latencyMs,
        embedMs,
        latencyEmbedExcludedMs: Math.max(0, latencyMs - embedMs),
        resultCount: out.results.length,
      });
      return out;
    }) satisfies SearchCodebaseRunner,

    explainFile: (async ({ path }) => explainFile({ db, repoId, path })) satisfies ExplainFileRunner,
  };

  return {
    env,
    db,
    repoId,
    ...runners,
    createServer: () => createCodeOracleMcpServer(runners),
  };
}
