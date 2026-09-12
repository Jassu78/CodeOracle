/** Structured latency line — stderr only (MCP stdio owns stdout). Never log query/topic/bodies. */
export type QueryLatencyFields = {
  tool: "search_codebase" | "find_decision";
  repoId: string;
  cache: "hit" | "miss" | "bypass" | "error";
  latencyMs: number;
  /** Embed duration on miss; null on hit/bypass/error-before-run. */
  embedMs: number | null;
  /** latencyMs - embedMs on miss; equals latencyMs on hit. */
  latencyEmbedExcludedMs: number | null;
  resultCount: number;
};

export function logQueryLatency(fields: QueryLatencyFields): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      component: "query-cache",
      msg: "query_latency",
      ...fields,
    }),
  );
}
