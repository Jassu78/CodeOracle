import { z } from "zod";

const ZERO_SHA = "0000000000000000000000000000000000000000";

const PushPayloadSchema = z.object({
  ref: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1),
  repository: z.object({
    full_name: z.string().min(1),
  }),
});

export type ParsedGithubPush = {
  ref: string;
  beforeSha: string;
  afterSha: string;
  githubFullName: string;
};

export type ParsePushResult =
  | { ok: true; push: ParsedGithubPush }
  | { ok: false; reason: string };

/**
 * Extract the fields needed to enqueue `incremental_reindex`.
 * Ignores tag pushes and branch deletions (after = zero SHA).
 */
export function parseGithubPushPayload(raw: unknown): ParsePushResult {
  const parsed = PushPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid push payload shape" };
  }

  const { ref, before, after, repository } = parsed.data;
  if (!ref.startsWith("refs/heads/")) {
    return { ok: false, reason: "ignored non-branch ref" };
  }
  if (after === ZERO_SHA) {
    return { ok: false, reason: "ignored branch deletion" };
  }

  return {
    ok: true,
    push: {
      ref,
      beforeSha: before,
      afterSha: after,
      githubFullName: repository.full_name,
    },
  };
}
