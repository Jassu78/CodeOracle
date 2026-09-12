import { closeDb } from "@codeoracle/db";
import { assertProductionSafety, effectiveBindHost } from "@codeoracle/config";
import { bootstrapMcpRuntime } from "./bootstrap.js";
import { listenHttp } from "./transport/http.js";
import { listenStdio } from "./transport/stdio.js";

/**
 * CODEORACLE_MCP_TRANSPORT=stdio|http (default stdio).
 * HTTP also: MCP_HTTP_PORT (default 3100), MCP_HTTP_HOST (default 127.0.0.1).
 */
async function main(): Promise<void> {
  const runtime = await bootstrapMcpRuntime();
  const transport = runtime.env.CODEORACLE_MCP_TRANSPORT;

  if (transport === "http" || transport === "streamable-http" || transport === "sse") {
    assertProductionSafety(runtime.env, {
      bindHosts: [effectiveBindHost(runtime.env.MCP_HTTP_HOST)],
      bindKind: "mcp",
    });
    const { close } = await listenHttp({
      runtime,
      port: runtime.env.MCP_HTTP_PORT,
      host: runtime.env.MCP_HTTP_HOST,
      rateLimitPerMinute: runtime.env.MCP_HTTP_RATE_LIMIT_PER_MINUTE,
    });
    const shutdown = async () => {
      await close();
      await closeDb(runtime.env.DATABASE_URL);
      await runtime.shutdownOtel();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    return;
  }

  await listenStdio(runtime);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
