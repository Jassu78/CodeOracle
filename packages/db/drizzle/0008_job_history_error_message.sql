-- G3.21: persist failure reasons for extract (and other) jobs.
ALTER TABLE "job_history" ADD COLUMN "error_message" text;
