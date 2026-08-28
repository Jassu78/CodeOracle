DELETE FROM "github_sources" a
USING "github_sources" b
WHERE a.repo_id = b.repo_id
  AND a.source_sha = b.source_sha
  AND a.ctid > b.ctid;
--> statement-breakpoint
DROP INDEX "github_sources_repo_sha_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "github_sources_repo_sha_unique" ON "github_sources" USING btree ("repo_id","source_sha");