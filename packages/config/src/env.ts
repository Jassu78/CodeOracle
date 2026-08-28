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

  GITHUB_PAT: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  MCP_HTTP_BEARER_TOKEN: z.string().optional(),
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
