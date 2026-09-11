/**
 * Shared MCP runtime wiring — loads env/db/gateway and builds tool runners.
 * Transports (stdio / HTTP) call this; they must not contain tool logic.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { loadEnv, loadProjectEnv, loadProvidersConfig, type Env, assertProductionSafety } from "@codeoracle/config";
import { createDb, repos, type Database } from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
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

  const runners = {
    findDecision: (async ({ topic, includeHistory }) =>
      findDecision({ db, qdrant, embed, repoId, topic, includeHistory })) satisfies FindDecisionRunner,
    searchCodebase: (async ({ query, topK }) =>
      searchCodebase({ db, qdrant, embed, repoId, query, topK })) satisfies SearchCodebaseRunner,
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
