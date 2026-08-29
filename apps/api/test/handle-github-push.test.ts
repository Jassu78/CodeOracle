import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleGithubWebhook } from "../src/webhooks/handle-github-push.js";

const secret = "whsec";
const repoId = "9462ddb7-6064-4620-87c7-584566f643af";

function signed(body: string): { raw: Buffer; sig: string } {
  const raw = Buffer.from(body, "utf8");
  const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return { raw, sig };
}

describe("handleGithubWebhook", () => {
  it("returns 401 on bad signature", async () => {
    const { raw } = signed("{}");
    const out = await handleGithubWebhook({
      rawBody: raw,
      signatureHeader: "sha256=deadbeef",
      eventHeader: "push",
      deps: {
        verifySecret: secret,
        findRepoByFullName: async () => null,
        enqueueIncremental: async () => "queued",
      },
    });
    expect(out.httpStatus).toBe(401);
  });

  it("pongs ping events without enqueue", async () => {
    const { raw, sig } = signed("{}");
    const enqueue = vi.fn(async () => "queued" as const);
    const out = await handleGithubWebhook({
      rawBody: raw,
      signatureHeader: sig,
      eventHeader: "ping",
      deps: {
        verifySecret: secret,
        findRepoByFullName: async () => null,
        enqueueIncremental: enqueue,
      },
    });
    expect(out.httpStatus).toBe(200);
    expect(out.body).toMatchObject({ pong: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues incremental_reindex with idempotent job id", async () => {
    const payload = {
      ref: "refs/heads/main",
      before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      after: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      repository: { full_name: "Jassu78/SpaceApps-2025-UrbanPlanner" },
    };
    const { raw, sig } = signed(JSON.stringify(payload));
    const enqueue = vi.fn(async () => "queued" as const);

    const out = await handleGithubWebhook({
      rawBody: raw,
      signatureHeader: sig,
      eventHeader: "push",
      deps: {
        verifySecret: secret,
        findRepoByFullName: async (name) => ({
          id: repoId,
          githubFullName: name,
          indexStatus: "ready",
        }),
        enqueueIncremental: enqueue,
      },
    });

    expect(out.httpStatus).toBe(202);
    expect(out.body).toMatchObject({ queued: true, repoId, afterSha: payload.after });
    expect(enqueue).toHaveBeenCalledOnce();
    const arg = enqueue.mock.calls[0]![0];
    expect(arg.payload).toEqual({
      repoId,
      beforeSha: payload.before,
      afterSha: payload.after,
    });
    expect(arg.jobId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns 200 duplicate when enqueue reports duplicate", async () => {
    const payload = {
      ref: "refs/heads/main",
      before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      after: "cccccccccccccccccccccccccccccccccccccccc",
      repository: { full_name: "org/repo" },
    };
    const { raw, sig } = signed(JSON.stringify(payload));
    const out = await handleGithubWebhook({
      rawBody: raw,
      signatureHeader: sig,
      eventHeader: "push",
      deps: {
        verifySecret: secret,
        findRepoByFullName: async () => ({
          id: repoId,
          githubFullName: "org/repo",
          indexStatus: "ready",
        }),
        enqueueIncremental: async () => "duplicate",
      },
    });
    expect(out.httpStatus).toBe(200);
    expect(out.body).toMatchObject({ duplicate: true });
  });

  it("returns 404 when repo is not registered", async () => {
    const payload = {
      ref: "refs/heads/main",
      before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      after: "dddddddddddddddddddddddddddddddddddddddd",
      repository: { full_name: "unknown/repo" },
    };
    const { raw, sig } = signed(JSON.stringify(payload));
    const out = await handleGithubWebhook({
      rawBody: raw,
      signatureHeader: sig,
      eventHeader: "push",
      deps: {
        verifySecret: secret,
        findRepoByFullName: async () => null,
        enqueueIncremental: async () => "queued",
      },
    });
    expect(out.httpStatus).toBe(404);
  });
});
