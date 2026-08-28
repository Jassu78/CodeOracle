-- Drizzle onConflictDoUpdate requires a table UNIQUE CONSTRAINT, not only a unique index.
DROP INDEX IF EXISTS "github_sources_repo_type_external_unique";--> statement-breakpoint
ALTER TABLE "github_sources" ADD CONSTRAINT "github_sources_repo_type_external_unique" UNIQUE ("repo_id", "source_type", "external_id");
