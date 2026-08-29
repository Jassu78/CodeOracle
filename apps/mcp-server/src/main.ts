import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import { closeDb, createDb, repos } from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
import {
  createQdrantClient,
  explainFile,
  findDecision,
  searchCodebase,
} from "@codeoracle/retrieval";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCodeOracleMcpServer } from "./create-server.js";
import { mcpLog } from "./log.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

async function main(): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();

  if (!env.CODEORACLE_REPO_ID) {
    throw new Error(
      "CODEORACLE_REPO_ID is required for mcp-server (UUID from `pnpm cli repo status`). See .env.example.",
    );
  }
  const repoId = env.CODEORACLE_REPO_ID;

  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const qdrant = createQdrantClient(env.QDRANT_URL);
  // Usage logs must stay off stdout (MCP protocol). Log failures to stderr only.
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

  // Probe Qdrant early so misconfig fails before the editor attaches.
  await qdrant.getCollections();

  const embed = async (texts: string[]) => (await gateway.embed(texts)).vectors;

  const server = createCodeOracleMcpServer({
    findDecision: async ({ topic, includeHistory }) =>
      findDecision({ db, qdrant, embed, repoId, topic, includeHistory }),
    searchCodebase: async ({ query, topK }) =>
      searchCodebase({ db, qdrant, embed, repoId, query, topK }),
    explainFile: async ({ path }) => explainFile({ db, repoId, path }),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  mcpLog("info", "MCP stdio server listening", {
    repoId,
    githubFullName: repo.githubFullName,
    tools: ["find_decision", "search_codebase", "explain_file"],
  });

  const shutdown = async () => {
    await server.close();
    await closeDb(env.DATABASE_URL);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
