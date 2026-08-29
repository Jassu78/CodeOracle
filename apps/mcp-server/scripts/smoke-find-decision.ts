/**
 * One-shot smoke for Step 2 — not part of unit tests.
 * Usage: pnpm --filter @codeoracle/mcp-server exec tsx scripts/smoke-find-decision.ts [topic]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import { closeDb, createDb } from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
import { createQdrantClient, findDecision } from "@codeoracle/retrieval";
import {
  formatFindDecisionText,
  runFindDecisionTool,
} from "../src/tools/find-decision.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const topic = process.argv[2] ?? "postgres";

async function main(): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  if (!env.CODEORACLE_REPO_ID) {
    throw new Error("CODEORACLE_REPO_ID required");
  }

  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const qdrant = createQdrantClient(env.QDRANT_URL);
  const gateway = new ProviderRegistry({ config: providers, env: process.env });

  try {
    const output = await runFindDecisionTool(
      ({ topic: t, includeHistory }) =>
        findDecision({
          db,
          qdrant,
          embed: async (texts) => (await gateway.embed(texts)).vectors,
          repoId: env.CODEORACLE_REPO_ID!,
          topic: t,
          includeHistory,
        }),
      { topic, includeHistory: false },
    );

    console.error(formatFindDecisionText(output));
    console.error(`\nresults=${output.results.length}`);
    if (output.results.length === 0) {
      process.exitCode = 2;
    }
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
