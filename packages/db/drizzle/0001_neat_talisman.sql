CREATE TABLE "github_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"body" text,
	"source_url" text,
	"source_sha" text NOT NULL,
	"merged_at" timestamp with time zone,
	"raw_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "local_clone_path" text;--> statement-breakpoint
ALTER TABLE "github_sources" ADD CONSTRAINT "github_sources_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_sources_repo_type_idx" ON "github_sources" USING btree ("repo_id","source_type");--> statement-breakpoint
CREATE INDEX "github_sources_repo_sha_idx" ON "github_sources" USING btree ("repo_id","source_sha");