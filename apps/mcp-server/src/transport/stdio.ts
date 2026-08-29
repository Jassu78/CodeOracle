import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb } from "@codeoracle/db";
import type { McpRuntime } from "../bootstrap.js";
import { mcpLog } from "../log.js";

/** Stdio MCP — local editor attach; no HTTP bearer (process isolation). */
export async function listenStdio(runtime: McpRuntime): Promise<void> {
  const server = runtime.createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  mcpLog("info", "MCP stdio server listening", {
    repoId: runtime.repoId,
    tools: ["find_decision", "search_codebase", "explain_file"],
  });

  const shutdown = async () => {
    await server.close();
    await closeDb(runtime.env.DATABASE_URL);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
