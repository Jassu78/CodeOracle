import {
  IncrementalReindexJobPayloadSchema,
  JOB_NAMES,
  type IncrementalReindexJobPayload,
} from "@codeoracle/contracts";
import { bullJobId } from "@codeoracle/queue";
import { parseGithubPushPayload } from "./parse-push.js";
import { verifyGitHubSignature } from "./github-signature.js";

export type WebhookRepo = {
  id: string;
  githubFullName: string;
  indexStatus: string;
};

export type EnqueueIncrementalResult =
  | { status: "queued"; jobId: string; repoId: string; afterSha: string }
  | { status: "duplicate"; jobId: string; repoId: string; afterSha: string };

export type HandleGithubWebhookDeps = {
  verifySecret: string;
  findRepoByFullName: (githubFullName: string) => Promise<WebhookRepo | null>;
  enqueueIncremental: (opts: {
    jobId: string;
    payload: IncrementalReindexJobPayload;
  }) => Promise<"queued" | "duplicate">;
};

export type HandleGithubWebhookResult =
  | { httpStatus: 202; body: Record<string, unknown> }
  | { httpStatus: 200; body: Record<string, unknown> }
  | { httpStatus: 400 | 401 | 404 | 503; body: Record<string, unknown> };

/**
 * Pure webhook handler — verify HMAC → parse push → resolve repo → enqueue.
 * No Nest/Express; transport adapter supplies raw body + deps.
 */
export async function handleGithubWebhook(
  opts: {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    eventHeader: string | undefined;
    deps: HandleGithubWebhookDeps;
  },
): Promise<HandleGithubWebhookResult> {
  if (!opts.deps.verifySecret) {
    return {
      httpStatus: 503,
      body: { error: "GITHUB_WEBHOOK_SECRET is not configured" },
    };
  }

  if (!verifyGitHubSignature(opts.rawBody, opts.signatureHeader, opts.deps.verifySecret)) {
    return { httpStatus: 401, body: { error: "invalid webhook signature" } };
  }

  const event = (opts.eventHeader ?? "").toLowerCase();
  if (event === "ping") {
    return { httpStatus: 200, body: { ok: true, pong: true } };
  }
  if (event && event !== "push") {
    return { httpStatus: 200, body: { ok: true, ignored: true, reason: `event ${event}` } };
  }

  let json: unknown;
  try {
    json = JSON.parse(opts.rawBody.toString("utf8")) as unknown;
  } catch {
    return { httpStatus: 400, body: { error: "body is not valid JSON" } };
  }

  const parsed = parseGithubPushPayload(json);
  if (!parsed.ok) {
    return { httpStatus: 200, body: { ok: true, ignored: true, reason: parsed.reason } };
  }

  const repo = await opts.deps.findRepoByFullName(parsed.push.githubFullName);
  if (!repo) {
    return {
      httpStatus: 404,
      body: {
        error: `repo not registered: ${parsed.push.githubFullName}`,
      },
    };
  }

  const payload = IncrementalReindexJobPayloadSchema.parse({
    repoId: repo.id,
    beforeSha: parsed.push.beforeSha,
    afterSha: parsed.push.afterSha,
  });

  const jobId = bullJobId("incremental_reindex", repo.id, parsed.push.afterSha);
  const enqueueStatus = await opts.deps.enqueueIncremental({ jobId, payload });

  if (enqueueStatus === "duplicate") {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        duplicate: true,
        job: JOB_NAMES.INCREMENTAL_REINDEX,
        jobId,
        repoId: repo.id,
        afterSha: parsed.push.afterSha,
      },
    };
  }

  return {
    httpStatus: 202,
    body: {
      ok: true,
      queued: true,
      job: JOB_NAMES.INCREMENTAL_REINDEX,
      jobId,
      repoId: repo.id,
      afterSha: parsed.push.afterSha,
    },
  };
}
