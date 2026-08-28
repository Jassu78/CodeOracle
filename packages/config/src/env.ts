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

  MCP_HTTP_BEARER_TOKEN: z.string().optional(),

  API_PORT: z.coerce.number().int().positive().default(3000),
  API_TOKEN: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(6),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(32),
  JOB_HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  EXTRACT_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Drop LLM decisions below this confidence (0-1). Default 0.5. */
  EXTRACT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  /** How many commits to keep in each GitHub clone for deterministic path lookup. */
  CLONE_HISTORY_DEPTH: z.coerce.number().int().positive().default(200),
  CLONE_MAX_REPOS: z.coerce.number().int().positive().default(50),
  INDEX_RECOVER_ON_STARTUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
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
