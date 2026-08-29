import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { closeDb, createDb, getRepoById } from "@codeoracle/db";

const projectRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

/** Pure formatter — testable without touching the filesystem/DB. */
export function formatCursorMcpConfig(opts: { projectRoot: string; repoId: string }): string {
  return JSON.stringify(
    {
      mcpServers: {
        codeoracle: {
          command: "pnpm",
          args: ["--dir", opts.projectRoot, "mcp"],
          env: {
            CODEORACLE_REPO_ID: opts.repoId,
          },
        },
      },
    },
    null,
    2,
  );
}

export async function runMcpConfig(repoId: string): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  try {
    const row = await getRepoById(db, repoId);
    if (!row) {
      p.log.error(`Unknown repo id ${repoId}`);
      process.exitCode = 1;
      return;
    }
    if (row.indexStatus !== "ready") {
      p.log.warn(
        `Repo index_status is "${row.indexStatus}" — MCP tools will return empty results until it reaches "ready".`,
      );
    }

    p.log.info(`Ready-to-paste MCP config for ${pc.cyan(row.githubFullName)}:`);
    console.log(formatCursorMcpConfig({ projectRoot, repoId }));
    p.log.message("");
    p.log.message(
      "Cursor: Settings → MCP → paste under mcpServers, or add to .cursor/mcp.json in this repo.",
    );
    p.log.message("Claude Code: paste the same shape into your MCP config file.");
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}
