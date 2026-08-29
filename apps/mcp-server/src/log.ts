/** MCP stdio: never write to stdout — that stream is JSON-RPC. */
export function mcpLog(
  level: "info" | "warn" | "error",
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component: "mcp-server",
    msg,
    ...fields,
  });
  console.error(line);
}
