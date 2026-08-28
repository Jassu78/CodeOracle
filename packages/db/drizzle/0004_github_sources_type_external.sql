-- Allow PR + commit rows to coexist (same merge SHA). Unique identity is type+external id.
DROP INDEX IF EXISTS "github_sources_repo_sha_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "github_sources_repo_type_external_unique" ON "github_sources" USING btree ("repo_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "github_sources_repo_sha_idx" ON "github_sources" USING btree ("repo_id","source_sha");
