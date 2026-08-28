CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"webhook_secret_hash" text NOT NULL,
	"last_full_index_at" timestamp with time zone,
	"last_incremental_at" timestamp with time zone,
	"index_status" text DEFAULT 'pending' NOT NULL,
	"embedding_model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"file_path" text NOT NULL,
	"symbol_name" text,
	"parent_symbol" text,
	"language" text NOT NULL,
	"byte_start" integer NOT NULL,
	"byte_end" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding_model_id" text,
	"qdrant_point_id" text,
	"last_indexed_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"summary" text NOT NULL,
	"alternatives_considered" text[] DEFAULT '{}'::text[] NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text NOT NULL,
	"source_sha" text NOT NULL,
	"touched_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidence" real NOT NULL,
	"superseded_by" uuid,
	"embedding_model_id" text,
	"extraction_model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"after_sha" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_superseded_by_decisions_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_github_full_name_unique" ON "repos" USING btree ("github_full_name");--> statement-breakpoint
CREATE INDEX "chunks_repo_file_idx" ON "chunks" USING btree ("repo_id","file_path");--> statement-breakpoint
CREATE INDEX "chunks_content_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_qdrant_point_unique" ON "chunks" USING btree ("qdrant_point_id");--> statement-breakpoint
CREATE INDEX "decisions_repo_idx" ON "decisions" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "decisions_source_url_idx" ON "decisions" USING btree ("source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "job_history_idempotency_unique" ON "job_history" USING btree ("repo_id","job_type","after_sha");