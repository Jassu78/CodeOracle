/**
 * One-shot smoke for Step 3 explain_file.
 * Usage: pnpm --filter @codeoracle/mcp-server exec tsx scripts/smoke-explain-file.ts [path]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { closeDb, createDb } from "@codeoracle/db";
import { explainFile } from "@codeoracle/retrieval";
import { formatExplainFileText, runExplainFileTool } from "../src/tools/explain-file.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const pathArg = process.argv[2] ?? "frontend/src/components/ClimateTrendsChart.tsx";

async function main(): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  if (!env.CODEORACLE_REPO_ID) throw new Error("CODEORACLE_REPO_ID required");

  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  try {
    const output = await runExplainFileTool(
      ({ path }) => explainFile({ db, repoId: env.CODEORACLE_REPO_ID!, path }),
      { path: pathArg },
    );
    console.error(formatExplainFileText(output));
    console.error(
      `\nchunks=${output.chunkSummaries.length} decisions=${output.relatedDecisions.length}`,
    );
    if (output.chunkSummaries.length === 0) process.exitCode = 2;
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
