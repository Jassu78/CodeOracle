import { z } from "zod";

/**
 * Env schema. Missing required values must throw at startup — never fall
 * back to an implicit default that masks misconfiguration.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required — see .env.example"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required — see .env.example"),

  QDRANT_URL: z.string().min(1, "QDRANT_URL is required — see .env.example"),

  CODEORACLE_CLONE_DIR: z.string().default("./data/clones"),
  PROVIDERS_CONFIG_PATH: z.string().default("./providers.yaml"),

  GITHUB_PAT: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OLLAMA_API_KEY: z.string().optional(),

  /**
   * Active repo for MCP (single-repo MVP). Required by mcp-server startup;
   * optional for worker/cli so other apps keep loading without it.
   * Empty string from `.env` (KEY=) is treated as unset.
   */
  CODEORACLE_REPO_ID: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().uuid().optional(),
  ),

  /** stdio (default) | http — Streamable HTTP + bearer (D5.3). */
  CODEORACLE_MCP_TRANSPORT: z.enum(["stdio", "http", "streamable-http", "sse"]).default("stdio"),

  /** Dedicated MCP HTTP bearer (optional; API_TOKEN or scoped api_tokens also work). */
  MCP_HTTP_BEARER_TOKEN: z.string().optional(),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3100),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  /** Max authenticated MCP HTTP requests per client IP per minute. */
  MCP_HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  API_PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Listen address for the HTTP API. Unset → Node binds all interfaces (`0.0.0.0`).
   * Prefer `127.0.0.1` for local dogfood; set `0.0.0.0` only behind a reverse proxy
   * with `API_TOKEN` when NODE_ENV=production.
   */
  API_HOST: z.string().optional(),
  API_TOKEN: z.string().optional(),

  /**
   * Comma-separated roots that may contain local clone/register paths.
   * Required in production whenever registering a local path (E6).
   * Does not replace P0-A secret basename denylist.
   */
  CODEORACLE_ALLOWED_ROOTS: z.preprocess((v) => {
    if (typeof v !== "string" || v.trim() === "") return [];
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, z.array(z.string())),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(6),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(32),
  JOB_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  EXTRACT_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Drop LLM decisions below this confidence (0-1). Default 0.5. */
  EXTRACT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  /**
   * Cap extract jobs queued after a full index (and default for CLI if unset).
   * 0 = no cap (queue all eligible sources). Use a small number for dogfood.
   */
  EXTRACT_QUEUE_LIMIT: z.coerce.number().int().nonnegative().default(0),
  /**
   * Soft per-repo daily token budget for extract_decisions (G3.19).
   * 0 = disabled. When exceeded, extract jobs finish as done/skipped without calling the LLM.
   */
  EXTRACT_REPO_DAILY_TOKEN_BUDGET: z.coerce.number().int().nonnegative().default(0),
  /** How many commits to keep in each GitHub clone for deterministic path lookup. */
  CLONE_HISTORY_DEPTH: z.coerce.number().int().positive().default(200),
  CLONE_MAX_REPOS: z.coerce.number().int().positive().default(50),
  INDEX_RECOVER_ON_STARTUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * E2/E2.1 post-fusion rerank kill-switch. Default off until eval shows lift.
   * When true, apps inject TEI via providers.yaml `rerank:` (see providers.yaml.example).
   * Without enabled endpoints, search stays identity (fused order).
   */
  SEARCH_RERANK_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Max hydrated candidates passed to rerank (latency budget). */
  SEARCH_RERANK_MAX_CANDIDATES: z.coerce.number().int().positive().default(20),
  /**
   * Fail-open timeout for a rerank call (ms). Default 150 is a local-CE target;
   * CPU TEI + bge-reranker-base often needs 400–500 — set that for dogfood ON path.
   */
  SEARCH_RERANK_TIMEOUT_MS: z.coerce.number().int().positive().default(150),
  /**
   * E5 Redis query-result cache for MCP search/find. Default on — fail-open on Redis errors.
   * Replay/eval should leave this off or bypass at the CLI edge.
   */
  QUERY_CACHE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /** TTL for cached tool payloads (seconds). Index epoch also busts keys on reindex. */
  QUERY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
});
export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const formatted = issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    super(`Invalid environment configuration:\n${formatted}\n\nSee .env.example for the required shape.`);
    this.name = "EnvValidationError";
  }
}

/**
 * Loads and validates process.env. Throws EnvValidationError (loud, typed
 * failure) rather than returning a partially-valid object or silently
 * defaulting anything security- or connectivity-relevant.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
