import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated via `drizzle-kit generate` and checked into
 * ./drizzle as SQL files — never `drizzle-kit push` (see architecture
 * decision log: reproducible/auditable migrations are required for an
 * OSS project other people self-host).
 */
// Explicit file list, not a glob — a glob like "./src/schema/*.ts" also
// matches schema.test.ts, which imports vitest and breaks drizzle-kit's
// CJS loader (found while verifying this scaffold end-to-end).
export default defineConfig({
  schema: [
    "./src/schema/repos.ts",
    "./src/schema/chunks.ts",
    "./src/schema/decisions.ts",
    "./src/schema/job-history.ts",
    "./src/schema/api-tokens.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://codeoracle:change-me-in-dev@localhost:5432/codeoracle",
  },
  strict: true,
  verbose: true,
});
