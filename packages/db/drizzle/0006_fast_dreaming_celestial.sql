-- NOTE: drizzle-kit's snapshot journal is out of sync with github_sources
-- (0004/0005 hand-patched that table outside `generate`), so the raw diff
-- also proposed re-touching github_sources indexes/constraints that are
-- already live. Trimmed to the api_tokens change this migration is actually
-- for — see 0004/0005 for the github_sources history.
CREATE UNIQUE INDEX "api_tokens_token_hash_unique" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_repo_idx" ON "api_tokens" USING btree ("repo_id");